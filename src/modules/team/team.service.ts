import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TeamRole, Conference, TeamIntelStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { NotificationService } from '../notification/notification.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TTeam, TTeamList } from './team.types';

const HOLDER_SELECT = {
  select: {
    role: true,
    user: { select: { id: true, name: true, email: true, image: true } },
  },
} satisfies Prisma.Team$membersArgs;

type TeamWithMembers = Prisma.TeamGetPayload<{
  include: { members: typeof HOLDER_SELECT };
}>;

const ROLE_LABEL: Record<TeamRole, string> = {
  owner: 'owner',
  coOwner: 'co-owner',
};

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async list(leagueId: number): Promise<TTeamList> {
    const [league, settings, teams] = await Promise.all([
      this.prisma.league.findUniqueOrThrow({
        where: { id: leagueId },
        select: { teamCount: true },
      }),
      this.prisma.leagueSettings.findUnique({
        where: { leagueId },
        select: { maxRosterSize: true },
      }),
      this.prisma.team.findMany({
        where: { leagueId },
        include: { members: HOLDER_SELECT },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      teamCount: league.teamCount,
      maxRosterSize: settings?.maxRosterSize ?? 0,
      teams: teams.map((team) => this.toTeam(team)),
    };
  }

  async create(leagueId: number, payload: CreateTeamDto): Promise<TTeam> {
    const league = await this.prisma.league.findUniqueOrThrow({
      where: { id: leagueId },
      select: { teamCount: true },
    });

    // teamCount is the cap the commissioner chose when creating the league.
    const existing = await this.prisma.team.count({ where: { leagueId } });
    if (existing >= league.teamCount) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `This league is limited to ${league.teamCount} teams. Raise the team limit before adding another.`,
      );
    }

    // Conferences alternate as teams are added, so a league ends up balanced
    // without the commissioner having to think about it. Moving a team
    // afterwards is a normal edit.
    const conference = existing % 2 === 0 ? Conference.east : Conference.west;

    const team = await this.write(() =>
      this.prisma.team.create({
        data: {
          leagueId,
          name: payload.name.trim(),
          abbr: payload.abbr.trim().toUpperCase(),
          color: payload.color ?? undefined,
          logo: payload.logo?.trim() || null,
          conference,
        },
        include: { members: HOLDER_SELECT },
      }),
    );

    return this.toTeam(team);
  }

  async update(
    leagueId: number,
    teamId: number,
    payload: UpdateTeamDto,
  ): Promise<TTeam> {
    await this.findTeam(leagueId, teamId);

    const data: Prisma.TeamUpdateInput = {};
    if (payload.name !== undefined) data.name = payload.name.trim();
    if (payload.abbr !== undefined)
      data.abbr = payload.abbr.trim().toUpperCase();
    if (payload.color !== undefined) data.color = payload.color;
    if (payload.logo !== undefined) data.logo = payload.logo?.trim() || null;

    const team = await this.write(() =>
      this.prisma.team.update({
        where: { id: teamId },
        data,
        include: { members: HOLDER_SELECT },
      }),
    );

    return this.toTeam(team);
  }

  async remove(leagueId: number, teamId: number) {
    const team = await this.findTeam(leagueId, teamId);

    // TeamMember rows cascade, so the owner and co-owner lose the team with it.
    await this.prisma.team.delete({ where: { id: teamId } });

    return { id: team.id, name: team.name };
  }

  /**
   * Sets who holds a role on a team. The same call covers assigning an empty
   * team and reassigning one that already has a holder, because the UI offers
   * a single "Assign / Reassign" action for both.
   */
  async assign(
    leagueId: number,
    teamId: number,
    userId: number,
    role: TeamRole,
  ) {
    const team = await this.findTeam(leagueId, teamId);

    const membership = await this.prisma.leagueMember.findUnique({
      where: { userId_leagueId: { userId, leagueId } },
      select: { user: { select: { name: true } } },
    });
    if (!membership) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'That user is not a member of this league. Invite them first.',
      );
    }

    // One user holds at most one team per league, so a user already placed
    // elsewhere has to be released from that team first. Moving them silently
    // would leave their old franchise unassigned without anyone asking.
    const placed = await this.prisma.teamMember.findUnique({
      where: { userId_leagueId: { userId, leagueId } },
      select: { teamId: true, role: true, team: { select: { name: true } } },
    });

    if (placed && placed.teamId !== teamId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${membership.user.name} is already the ${ROLE_LABEL[placed.role]} of ${placed.team.name}. Remove them from that team first.`,
      );
    }
    if (placed && placed.role === role) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${membership.user.name} is already the ${ROLE_LABEL[role]} of this team.`,
      );
    }

    const outgoing = await this.prisma.teamMember.findFirst({
      where: { teamId, role },
      select: { userId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      // Clear the seat before filling it: nothing stops two owners on one team
      // at the database level.
      await tx.teamMember.deleteMany({ where: { teamId, role } });
      await tx.teamMember.upsert({
        where: { userId_leagueId: { userId, leagueId } },
        create: { userId, leagueId, teamId, role },
        update: { teamId, role },
      });
    });

    const label = ROLE_LABEL[role];

    await this.notificationService.notify({
      userId,
      leagueId,
      type: 'announcement',
      title: `You are now the ${label} of ${team.name}`,
      detail: `The commissioner assigned you ${team.name}.`,
      link: '/my-team',
    });

    if (outgoing && outgoing.userId !== userId) {
      await this.notificationService.notify({
        userId: outgoing.userId,
        leagueId,
        type: 'announcement',
        title: `You are no longer the ${label} of ${team.name}`,
        detail: `The commissioner reassigned ${team.name}.`,
        link: '/home',
      });
    }

    return this.byId(leagueId, teamId);
  }

  async unassign(leagueId: number, teamId: number, role: TeamRole) {
    const team = await this.findTeam(leagueId, teamId);

    const holder = await this.prisma.teamMember.findFirst({
      where: { teamId, role },
      select: { userId: true },
    });
    if (!holder) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        `This team has no ${ROLE_LABEL[role]} to remove.`,
      );
    }

    await this.prisma.teamMember.deleteMany({ where: { teamId, role } });

    await this.notificationService.notify({
      userId: holder.userId,
      leagueId,
      type: 'announcement',
      title: `You are no longer the ${ROLE_LABEL[role]} of ${team.name}`,
      detail: `The commissioner removed you from ${team.name}.`,
      link: '/home',
    });

    return this.byId(leagueId, teamId);
  }

  private async byId(leagueId: number, teamId: number): Promise<TTeam> {
    const team = await this.prisma.team.findFirstOrThrow({
      where: { id: teamId, leagueId },
      include: { members: HOLDER_SELECT },
    });

    return this.toTeam(team);
  }

  private async findTeam(leagueId: number, teamId: number) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true },
    });

    if (!team) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Team not found.');
    }

    return team;
  }

  /** Turns the two unique constraints on Team into messages worth reading. */
  private async write<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = String(error.meta?.target ?? '');
        if (target.includes('abbr')) {
          throw new AppError(
            HttpStatus.CONFLICT,
            'Another team in this league already uses that abbreviation.',
          );
        }
        throw new AppError(
          HttpStatus.CONFLICT,
          'Another team in this league already uses that name.',
        );
      }
      throw error;
    }
  }

  private toTeam(team: TeamWithMembers): TTeam {
    const holder = (role: TeamRole) => {
      const found = team.members.find((member) => member.role === role);
      if (!found) return null;
      return {
        userId: found.user.id,
        name: found.user.name,
        email: found.user.email,
        image: found.user.image,
        role: found.role,
      };
    };

    return {
      id: team.id,
      leagueId: team.leagueId,
      name: team.name,
      abbr: team.abbr,
      color: team.color,
      logo: team.logo,
      owner: holder(TeamRole.owner),
      coOwner: holder(TeamRole.coOwner),
      intelStatus: team.intelStatus,
      createdAt: team.createdAt,
    };
  }

  /**
   * League Intel — what this team says it is doing.
   *
   * Set by the team's own owner or co-owner, and by a commissioner on their
   * behalf. Not by any other member: the whole value of the field is that it
   * is self-reported, and intel somebody else wrote about you would be a
   * different feature with a different name.
   *
   * `null` clears it, which is the "clear intel" option on the dropdown, and
   * is why the column is nullable rather than defaulted.
   */
  async setIntel(
    leagueId: number,
    teamId: number,
    status: TeamIntelStatus | null,
    userId: number,
    canManageAnyTeam: boolean,
  ): Promise<TTeam> {
    await this.findTeam(leagueId, teamId);

    if (!canManageAnyTeam) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { leagueId, teamId, userId },
        select: { id: true },
      });
      if (!membership) {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'Only this team can set its own league intel.',
        );
      }
    }

    const team = await this.prisma.team.update({
      where: { id: teamId },
      data: { intelStatus: status },
      include: { members: HOLDER_SELECT },
    });

    return this.toTeam(team);
  }
}
