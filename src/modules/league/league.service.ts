import { HttpStatus, Injectable } from '@nestjs/common';
import { LeagueRole, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { parseSeasonLabel } from '../../utils/season';
import { CapService } from '../cap/cap.service';
import { HardCapService } from '../cap/hard-cap.service';
import { NotificationService } from '../notification/notification.service';
import { buildDefaultCalendar, nextSeason } from './calendar.template';
import {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from './dto/calendar-event.dto';
import { AddCoCommissionerDto } from './dto/co-commissioner.dto';
import { CreateLeagueDto } from './dto/create-league.dto';
import { UpdateLeagueSettingsDto } from './dto/update-league-settings.dto';
import { UpdateLeagueDto } from './dto/update-league.dto';
import {
  TCapThresholds,
  TLeagueMember,
  TLeagueSummary,
  TUiLeagueRole,
} from './league.types';

const DEFAULT_TEAM_COUNT = 12;

@Injectable()
export class LeagueService {
  constructor(
    private prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly capService: CapService,
    private readonly hardCap: HardCapService,
  ) {}
  private currentSeason(now = new Date()) {
    const year = now.getFullYear();
    const startYear = now.getMonth() >= 9 ? year : year - 1;
    const endShort = String((startYear + 1) % 100).padStart(2, '0');
    return `${startYear}-${endShort}`;
  }
  private toUiRoles(leagueRole: LeagueRole, hasTeam: boolean): TUiLeagueRole[] {
    const roles: TUiLeagueRole[] = [];

    if (hasTeam) roles.push('Team Owner');
    if (leagueRole !== LeagueRole.member) roles.push('Commissioner');

    return roles;
  }

  async createLeague(userId: number, payload: CreateLeagueDto) {
    const season = this.currentSeason();

    // Teams are not created here. teamCount only caps how many the
    // commissioner may add later from the league office.
    const league = await this.prisma.league.create({
      data: {
        name: payload.name.trim(),
        logo: payload.logo?.trim() || null,
        teamCount: payload.teamCount ?? DEFAULT_TEAM_COUNT,
        season,
        scoringType: payload.scoringType,
        draftType: payload.draftType,
        visibility: payload.visibility,
        createdById: userId,
        members: {
          create: {
            userId,
            role: LeagueRole.commissioner,
          },
        },
        // Created empty so every column takes its schema default. The
        // settings page then always has a row to read.
        settings: { create: {} },
        // The commissioner starts from the standard league calendar and edits
        // it from there, rather than typing nineteen dates by hand.
        calendarEvents: { create: buildDefaultCalendar(season) },
      },
    });

    return this.toSummary(league, LeagueRole.commissioner, null);
  }

  async myLeagues(userId: number): Promise<TLeagueSummary[]> {
    const memberships = await this.prisma.leagueMember.findMany({
      where: {
        userId,
        league: { isDeleted: false },
      },
      include: { league: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!memberships.length) return [];

    const teamMemberships = await this.prisma.teamMember.findMany({
      where: {
        userId,
        leagueId: { in: memberships.map((m) => m.leagueId) },
      },
      include: { team: { select: { id: true, name: true, logo: true } } },
    });

    const teamByLeague = new Map(
      teamMemberships.map((membership) => [membership.leagueId, membership]),
    );

    return memberships.map((membership) =>
      this.toSummary(
        membership.league,
        membership.role,
        teamByLeague.get(membership.leagueId) ?? null,
      ),
    );
  }

  private toSummary(
    league: Prisma.LeagueGetPayload<object>,
    leagueRole: LeagueRole,
    teamMembership: {
      role: string;
      team: { id: number; name: string; logo: string | null };
    } | null,
  ): TLeagueSummary {
    return {
      id: league.id,
      name: league.name,
      logo: league.logo,
      teamCount: league.teamCount,
      season: league.season,
      scoringType: league.scoringType,
      draftType: league.draftType,
      visibility: league.visibility,
      leagueRole,
      roles: this.toUiRoles(leagueRole, Boolean(teamMembership)),
      team: teamMembership
        ? {
            id: teamMembership.team.id,
            name: teamMembership.team.name,
            logo: teamMembership.team.logo,
            role: teamMembership.role,
          }
        : null,
      createdAt: league.createdAt,
    };
  }

  async updateLeague(leagueId: number, payload: UpdateLeagueDto) {
    const data: Prisma.LeagueUpdateInput = {};
    if (payload.name !== undefined) data.name = payload.name.trim();
    if (payload.logo !== undefined) data.logo = payload.logo?.trim() || null;
    if (payload.visibility !== undefined) data.visibility = payload.visibility;

    if (!Object.keys(data).length) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Nothing to update.');
    }

    const league = await this.prisma.league.update({
      where: { id: leagueId },
      data,
    });

    return {
      id: league.id,
      name: league.name,
      logo: league.logo,
      visibility: league.visibility,
      teamCount: league.teamCount,
      season: league.season,
    };
  }

  async getSettings(leagueId: number) {
    // Leagues created before the settings table existed have no row, so one
    // is written on first read rather than failing.
    const settings = await this.prisma.leagueSettings.upsert({
      where: { leagueId },
      update: {},
      create: { leagueId },
    });

    return this.toSettingsPayload(
      settings,
      await this.seasonStartYearOf(leagueId),
    );
  }

  async updateSettings(leagueId: number, payload: UpdateLeagueSettingsDto) {
    const existing = await this.prisma.leagueSettings.upsert({
      where: { leagueId },
      update: {},
      create: { leagueId },
    });

    // Switching mode after the first import or draft would orphan every
    // contract already entered, so it is refused once locked.
    if (
      payload.setupMode !== undefined &&
      payload.setupMode !== existing.setupMode &&
      existing.setupLocked
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'League setup can no longer be changed because players have already been brought in.',
      );
    }

    const data: Prisma.LeagueSettingsUpdateInput = { ...payload };

    if (!Object.keys(data).length) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Nothing to update.');
    }

    this.assertSettingsAreCoherent({ ...existing, ...payload });

    const settings = await this.prisma.leagueSettings.update({
      where: { leagueId },
      data,
    });

    return this.toSettingsPayload(
      settings,
      await this.seasonStartYearOf(leagueId),
    );
  }

  async members(leagueId: number): Promise<TLeagueMember[]> {
    const memberships = await this.prisma.leagueMember.findMany({
      where: { leagueId },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!memberships.length) return [];

    // One extra query instead of one per member. The team comes along: a
    // member list that says someone holds a team without saying which one
    // makes every caller look it up again.
    const teamMembers = await this.prisma.teamMember.findMany({
      where: { leagueId },
      select: {
        userId: true,
        team: { select: { id: true, name: true, abbr: true, logo: true } },
      },
    });
    const teamByUserId = new Map(
      teamMembers.map((member) => [member.userId, member.team]),
    );

    return memberships.map((membership) => ({
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      image: membership.user.image,
      role: membership.role,
      hasTeam: teamByUserId.has(membership.user.id),
      team: teamByUserId.get(membership.user.id) ?? null,
      joinedAt: membership.createdAt,
    }));
  }

  async addCoCommissioner(
    leagueId: number,
    payload: AddCoCommissionerDto,
    actingUserId: number,
  ) {
    if (payload.userId === actingUserId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'You cannot change your own role.',
      );
    }

    const membership = await this.prisma.leagueMember.findUnique({
      where: { userId_leagueId: { userId: payload.userId, leagueId } },
    });

    if (!membership) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'That user is not a member of this league.',
      );
    }
    if (membership.role === LeagueRole.commissioner) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'That user is already the commissioner of this league.',
      );
    }
    if (membership.role === LeagueRole.coCommissioner) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'That user is already a co-commissioner.',
      );
    }

    const updated = await this.prisma.leagueMember.update({
      where: { userId_leagueId: { userId: payload.userId, leagueId } },
      data: { role: LeagueRole.coCommissioner },
      include: { league: { select: { name: true } } },
    });

    await this.notificationService.notify({
      userId: payload.userId,
      leagueId,
      type: 'announcement',
      title: 'You are now a Co-Commissioner',
      detail: `You can now manage ${updated.league.name}.`,
      link: '/league-office/settings',
    });

    return { userId: payload.userId, role: updated.role };
  }

  async removeCoCommissioner(
    leagueId: number,
    userId: number,
    actingUserId: number,
  ) {
    if (userId === actingUserId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'You cannot change your own role.',
      );
    }

    const membership = await this.prisma.leagueMember.findUnique({
      where: { userId_leagueId: { userId, leagueId } },
    });

    if (!membership || membership.role !== LeagueRole.coCommissioner) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'That user is not a co-commissioner of this league.',
      );
    }

    const updated = await this.prisma.leagueMember.update({
      where: { userId_leagueId: { userId, leagueId } },
      data: { role: LeagueRole.member },
    });

    return { userId, role: updated.role };
  }

  /**
   * The thresholds a settings page shows.
   *
   * Article 2 says the tax line and both aprons are **entered** by the Super
   * Admin each league year, so these come from the cap engine. The
   * multipliers that used to live here were close but not the client's
   * figures: 127% against their 126.71% is about $480,000 on a $165M cap,
   * enough to put a team in the wrong tier.
   */
  /** The league year a league is currently in, as the year it starts in. */
  private async seasonStartYearOf(leagueId: number) {
    const league = await this.prisma.league.findUnique({
      where: { id: leagueId },
      select: { season: true },
    });
    return (
      (league ? parseSeasonLabel(league.season) : null) ??
      new Date().getUTCFullYear()
    );
  }

  private async capThresholds(
    leagueId: number,
    seasonStartYear: number,
  ): Promise<TCapThresholds> {
    const cap = await this.capService.forLeague(leagueId, seasonStartYear);
    return {
      salaryFloor: cap.salaryFloor,
      luxuryTax: cap.luxuryTax,
      firstApron: cap.firstApron,
      secondApron: cap.secondApron,
      // Rule 10.2 — the real maximum depends on years of service. This is the
      // highest of the three, which is what a cap page shows as the ceiling.
      maxPlayerSalary: cap.maxSalary10Plus,
    };
  }

  private async toSettingsPayload(
    settings: Prisma.LeagueSettingsGetPayload<object>,
    seasonStartYear: number,
  ) {
    const thresholds = await this.capThresholds(
      settings.leagueId,
      seasonStartYear,
    );

    return {
      leagueId: settings.leagueId,
      setupMode: settings.setupMode,
      setupLocked: settings.setupLocked,
      freeAgencyStyle: settings.freeAgencyStyle,
      trading: {
        salaryMatching: settings.salaryMatching,
        apronRules: settings.apronRules,
        allowTradeExceptions: settings.allowTradeExceptions,
        allowTradingTradeExceptions: settings.allowTradingTradeExceptions,
        allowDraftPickTrading: settings.allowDraftPickTrading,
        pickTradingWindowDrafts: settings.pickTradingWindowDrafts,
        commissionerTradeApproval: settings.commissionerTradeApproval,
      },
      salaryCap: settings.salaryCap,
      minPlayerSalary: settings.minPlayerSalary,
      hardCapEnabled: settings.hardCapEnabled,
      hardCapThreshold: settings.hardCapThreshold,
      roster: {
        minRosterSize: settings.minRosterSize,
        maxRosterSize: settings.maxRosterSize,
        maxTwoWay: settings.maxTwoWay,
        slots: {
          guard: settings.slotGuard,
          forward: settings.slotForward,
          center: settings.slotCenter,
          flex: settings.slotFlex,
          bench: settings.slotBench,
          ir: settings.slotIr,
        },
        pregameLockMinutes: settings.pregameLockMinutes,
      },
      // Entered by the Super Admin each league year (Article 2), not worked
      // out from the cap by a multiplier.
      thresholds,
      updatedAt: settings.updatedAt,
    };
  }

  // Only combinations that make a league impossible to run are refused. How
  // the slots add up is left to the commissioner, because leagues count
  // bench and injured spots differently.
  private assertSettingsAreCoherent(next: {
    minRosterSize: number;
    maxRosterSize: number;
    maxTwoWay: number;
    salaryCap: number;
    minPlayerSalary: number;
  }) {
    if (next.minRosterSize > next.maxRosterSize) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Minimum roster size cannot be larger than the maximum.',
      );
    }

    if (next.maxTwoWay > next.maxRosterSize) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Two-way contract spots cannot exceed the maximum roster size.',
      );
    }

    // A cap of 0 means it has not been set yet, so there is nothing to check
    // it against. Checking anyway would block the commissioner from entering
    // the minimum salary before the cap.
    if (next.salaryCap === 0) return;

    // Fielding the minimum roster at the minimum salary already costs this
    // much, so a cap below it can never be met by any team.
    const floor = next.minRosterSize * next.minPlayerSalary;
    if (next.salaryCap < floor) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `Salary cap must be at least $${floor.toLocaleString('en-US')} to field ${next.minRosterSize} players at the minimum salary.`,
      );
    }
  }

  async calendar(leagueId: number, season?: string) {
    const league = await this.prisma.league.findUniqueOrThrow({
      where: { id: leagueId },
      select: { season: true },
    });

    const target = season ?? league.season;

    const events = await this.prisma.leagueCalendarEvent.findMany({
      where: { leagueId, season: target },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });

    // Every season the league has any date for, so the picker is built from
    // real rows rather than a guessed range of years.
    const grouped = await this.prisma.leagueCalendarEvent.groupBy({
      by: ['season'],
      where: { leagueId },
      orderBy: { season: 'asc' },
    });

    const seasons = grouped.map((row) => row.season);

    return {
      season: target,
      currentSeason: league.season,
      seasons: seasons.length ? seasons : [league.season],
      events,
    };
  }

  async createCalendarEvent(leagueId: number, payload: CreateCalendarEventDto) {
    const league = await this.prisma.league.findUniqueOrThrow({
      where: { id: leagueId },
      select: { season: true },
    });

    const startDate = new Date(payload.startDate);
    const endDate = payload.endDate ? new Date(payload.endDate) : null;

    if (endDate && endDate < startDate) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'The end date cannot fall before the start date.',
      );
    }

    return this.prisma.leagueCalendarEvent.create({
      data: {
        leagueId,
        season: payload.season ?? league.season,
        title: payload.title.trim(),
        phase: payload.phase,
        description: payload.description?.trim() ?? '',
        startDate,
        endDate,
        isApproximate: payload.isApproximate ?? false,
        displayLabel: payload.displayLabel?.trim() || null,
        time: payload.time?.trim() || null,
      },
    });
  }

  async updateCalendarEvent(
    leagueId: number,
    eventId: number,
    payload: UpdateCalendarEventDto,
  ) {
    const existing = await this.findCalendarEvent(leagueId, eventId);

    const data: Prisma.LeagueCalendarEventUpdateInput = {};
    if (payload.title !== undefined) data.title = payload.title.trim();
    if (payload.phase !== undefined) data.phase = payload.phase;
    if (payload.description !== undefined) {
      data.description = payload.description.trim();
    }
    if (payload.startDate !== undefined) {
      data.startDate = new Date(payload.startDate);
    }
    if (payload.endDate !== undefined) {
      data.endDate = payload.endDate ? new Date(payload.endDate) : null;
    }
    if (payload.isApproximate !== undefined) {
      data.isApproximate = payload.isApproximate;
    }
    if (payload.displayLabel !== undefined) {
      data.displayLabel = payload.displayLabel?.trim() || null;
    }
    if (payload.time !== undefined) {
      data.time = payload.time?.trim() || null;
    }

    if (!Object.keys(data).length) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Nothing to update.');
    }

    const start = (data.startDate as Date | undefined) ?? existing.startDate;
    const end =
      payload.endDate !== undefined
        ? (data.endDate as Date | null)
        : existing.endDate;

    if (end && end < start) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'The end date cannot fall before the start date.',
      );
    }

    return this.prisma.leagueCalendarEvent.update({
      where: { id: eventId },
      data,
    });
  }

  async deleteCalendarEvent(leagueId: number, eventId: number) {
    await this.findCalendarEvent(leagueId, eventId);

    await this.prisma.leagueCalendarEvent.delete({ where: { id: eventId } });

    return null;
  }

  // Builds the next season's calendar from this one, so a league does not
  // start each year from an empty table.
  async rollOverCalendar(leagueId: number, fromSeason?: string) {
    const league = await this.prisma.league.findUniqueOrThrow({
      where: { id: leagueId },
      select: { season: true },
    });

    const source = fromSeason ?? league.season;
    const target = nextSeason(source);

    const existing = await this.prisma.leagueCalendarEvent.count({
      where: { leagueId, season: target },
    });
    if (existing) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${target} already has a calendar.`,
      );
    }

    const events = await this.prisma.leagueCalendarEvent.findMany({
      where: { leagueId, season: source },
      orderBy: { startDate: 'asc' },
    });

    const rows = (events.length ? events : buildDefaultCalendar(source)).map(
      (event) => ({
        leagueId,
        season: target,
        title: event.title,
        phase: event.phase,
        description: event.description,
        startDate: this.shiftYear(event.startDate),
        endDate: event.endDate ? this.shiftYear(event.endDate) : null,
        isApproximate: event.isApproximate,
        displayLabel: event.displayLabel
          ? this.shiftLabelYear(event.displayLabel)
          : null,
        isDefault: false,
      }),
    );

    await this.prisma.leagueCalendarEvent.createMany({ data: rows });

    // Rule 4.6 — every team starts the new league year with no hard cap. A
    // cap is keyed to its own year, so last year's rows already match nothing;
    // this clears them away rather than leaving them to pile up.
    const targetYear = parseSeasonLabel(target);
    const hardCaps = targetYear
      ? await this.hardCap.clearForRollover(leagueId, targetYear)
      : { cleared: 0 };

    return {
      season: target,
      created: rows.length,
      hardCapsCleared: hardCaps.cleared,
    };
  }

  // Kept in UTC so a deadline does not move a day depending on the server.
  private shiftYear(date: Date) {
    const shifted = new Date(date);
    shifted.setUTCFullYear(shifted.getUTCFullYear() + 1);
    return shifted;
  }

  private shiftLabelYear(label: string) {
    return label.replace(/\b(19|20)\d{2}\b/, (year) =>
      String(Number(year) + 1),
    );
  }

  private async findCalendarEvent(leagueId: number, eventId: number) {
    const event = await this.prisma.leagueCalendarEvent.findUnique({
      where: { id: eventId },
    });

    // Checked against the league so an id from another league cannot be
    // reached by guessing.
    if (!event || event.leagueId !== leagueId) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Calendar event not found.');
    }

    return event;
  }
}
