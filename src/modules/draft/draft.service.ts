import { HttpStatus, Injectable } from '@nestjs/common';
import { DraftFormat, DraftKind, Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { DraftPicksService } from './draft.picks.service';
import {
  PlayerStatsService,
  type SeasonAverage,
} from '../nba/player-stats.service';
import {
  PickShape,
  buildDraftOrder,
  draftYearLabel,
  orderFlags,
} from './draft.rules';
import { ListPoolDto } from './dto/list-pool.dto';
import { SetDraftOrderDto } from './dto/set-draft-order.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';

/** How many players a pool page returns at once. */
const POOL_PAGE_SIZE = 25;

@Injectable()
export class DraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly picks: DraftPicksService,
    private readonly playerStats: PlayerStatsService,
  ) {}

  /**
   * The draft row for a league and kind, created on first read.
   *
   * A commissioner opening the settings page expects to see the defaults, not
   * an empty screen with a "create" button: the draft exists as soon as the
   * league does. A startup draft belongs to the league's first year and stays
   * there; a rookie draft belongs to whichever year the league is in now.
   */
  private async ensureDraft(leagueId: number, kind: DraftKind) {
    const seasonStartYear = await this.picks.currentSeasonStartYear(leagueId);

    const existing = await this.prisma.leagueDraft.findFirst({
      where:
        kind === DraftKind.startup
          ? { leagueId, kind }
          : { leagueId, kind, seasonStartYear },
      orderBy: { seasonStartYear: 'asc' },
    });
    if (existing) return existing;

    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { id: true, draftType: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found.');
    }

    return this.prisma.leagueDraft.create({
      data: {
        leagueId,
        kind,
        seasonStartYear,
        // A startup draft runs through the whole NBA, so it needs many more
        // rounds than a rookie draft, which only has the new class.
        rounds: kind === DraftKind.startup ? 13 : 2,
        format: DraftFormat.snake,
      },
    });
  }

  /** Settings, order and the flags Rule 12.4 asks the commissioner to resolve. */
  async get(leagueId: number, kind: DraftKind) {
    const draft = await this.ensureDraft(leagueId, kind);

    const [slots, teams, picks, poolCounts] = await Promise.all([
      this.prisma.draftOrderSlot.findMany({
        where: { draftId: draft.id },
        orderBy: { overall: 'asc' },
        include: {
          team: { select: { id: true, name: true, abbr: true, logo: true } },
          player: { select: { id: true, name: true, position: true } },
          // Whose seat this is. A traded pick is picked by one team and owed
          // by another, and the order editor drags the original team.
          draftPick: {
            select: {
              id: true,
              originalTeamId: true,
              protectedTopN: true,
              frozenInSeason: true,
            },
          },
        },
      }),
      this.prisma.team.findMany({
        where: { leagueId },
        select: {
          id: true,
          name: true,
          abbr: true,
          logo: true,
          members: {
            where: { role: 'owner' },
            select: { user: { select: { id: true, name: true } } },
            take: 1,
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.draftPick.findMany({
        where: { leagueId, seasonStartYear: draft.seasonStartYear },
        select: {
          id: true,
          seasonStartYear: true,
          round: true,
          originalTeamId: true,
          currentTeamId: true,
          protectedTopN: true,
          protectionOutcome: true,
          protectionFinalYear: true,
          frozenInSeason: true,
          movedToEndOfRound: true,
          usedAt: true,
        },
      }),
      this.poolCounts(leagueId, kind, draft.seasonStartYear),
    ]);

    const teamById = new Map(
      teams.map((team) => [
        team.id,
        { id: team.id, name: team.name, abbr: team.abbr, logo: team.logo },
      ]),
    );

    return {
      id: draft.id,
      kind: draft.kind,
      seasonStartYear: draft.seasonStartYear,
      yearLabel: draftYearLabel(draft.seasonStartYear),

      rounds: draft.rounds,
      format: draft.format,
      // The page shows one switch, not a format dropdown, so the boolean it
      // binds to is named here rather than derived in three components.
      snakeOrder: draft.format === DraftFormat.snake,
      reversalRound: draft.reversalRound,

      startsAt: draft.startsAt,
      timezone: draft.timezone,
      pickSeconds: draft.pickSeconds,
      autoSetOrder: draft.autoSetOrder,
      status: draft.status,

      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        abbr: team.abbr,
        logo: team.logo,
        ownerName: team.members[0]?.user.name ?? null,
      })),

      order: slots.map((slot) => ({
        id: slot.id,
        round: slot.round,
        pickInRound: slot.pickInRound,
        overall: slot.overall,
        team: slot.team,
        // The seat's own team. Equal to `team` until the pick is traded.
        originalTeam: slot.draftPick
          ? (teamById.get(slot.draftPick.originalTeamId) ?? slot.team)
          : slot.team,
        isTraded: Boolean(
          slot.draftPick && slot.draftPick.originalTeamId !== slot.teamId,
        ),
        isFrozen: slot.draftPick?.frozenInSeason != null,
        protectedTopN: slot.draftPick?.protectedTopN ?? null,
        draftPickId: slot.draftPickId,
        player: slot.player,
        pickedAt: slot.pickedAt,
      })),

      // Rule 12.4 — what the engine cannot place for them.
      flags: orderFlags(
        picks as (PickShape & { movedToEndOfRound: boolean })[],
        draft.seasonStartYear,
      ),

      pool: poolCounts,
    };
  }

  async update(leagueId: number, kind: DraftKind, input: UpdateDraftDto) {
    const draft = await this.ensureDraft(leagueId, kind);

    if (
      input.reversalRound !== undefined &&
      input.rounds !== undefined &&
      input.reversalRound > input.rounds
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'The reversal round cannot be later than the last round.',
      );
    }

    const data: Prisma.LeagueDraftUpdateInput = {};

    if (input.rounds !== undefined) data.rounds = input.rounds;
    if (input.reversalRound !== undefined) {
      data.reversalRound = input.reversalRound;
    }
    // The page sends one switch; the stored value is the format, because a
    // boolean would not survive a third format being added.
    if (input.snakeOrder !== undefined) {
      data.format = input.snakeOrder ? DraftFormat.snake : DraftFormat.linear;
    }
    if (input.format !== undefined) data.format = input.format;
    if (input.pickSeconds !== undefined) data.pickSeconds = input.pickSeconds;
    if (input.autoSetOrder !== undefined) {
      data.autoSetOrder = input.autoSetOrder;
    }
    if (input.timezone !== undefined) data.timezone = input.timezone || null;
    if (input.startsAt !== undefined) {
      data.startsAt = input.startsAt ? new Date(input.startsAt) : null;
    }
    if (input.status !== undefined) data.status = input.status;

    await this.prisma.leagueDraft.update({ where: { id: draft.id }, data });

    // Turning the switch on is the act: it randomizes the order once and lays
    // every round out from it. Leaving it on does not reshuffle on each save,
    // which would throw away an order the commissioner had just looked at.
    const turnedOn =
      input.autoSetOrder === true && draft.autoSetOrder === false;
    if (turnedOn) {
      return this.buildOrder(leagueId, kind, { randomize: true });
    }

    return this.get(leagueId, kind);
  }

  /**
   * The order, as the commissioner entered it (Rule 12.4).
   *
   * Replaced whole rather than patched row by row: the page hands back the
   * list it is showing, and a partial update would leave two rows claiming the
   * same overall pick if a drag were lost on the way.
   *
   * `teamId` on the way in is the team whose **seat** this is, which is what
   * the commissioner drags. Who actually picks there is not theirs to choose:
   * it is whoever holds that pick now, so it is resolved here from the
   * inventory rather than trusted from the request.
   */
  async setOrder(leagueId: number, kind: DraftKind, input: SetDraftOrderDto) {
    const draft = await this.ensureDraft(leagueId, kind);

    const [teams, picks] = await Promise.all([
      this.prisma.team.findMany({
        where: { leagueId },
        select: { id: true },
      }),
      this.prisma.draftPick.findMany({
        where: { leagueId, seasonStartYear: draft.seasonStartYear },
        select: {
          id: true,
          round: true,
          originalTeamId: true,
          currentTeamId: true,
        },
      }),
    ]);
    const teamIds = new Set(teams.map((team) => team.id));

    // One pick per round per original team, which is the unique key.
    const pickBySeat = new Map(
      picks.map((pick) => [`${pick.round}:${pick.originalTeamId}`, pick]),
    );

    const slots = input.order.map((slot, index) => {
      if (!teamIds.has(slot.teamId)) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          `Team ${slot.teamId} is not in this league.`,
        );
      }

      const pick = pickBySeat.get(`${slot.round}:${slot.teamId}`);

      return {
        draftId: draft.id,
        round: slot.round,
        pickInRound: slot.pickInRound,
        overall: slot.overall ?? index + 1,
        // A traded pick moves the seat to whoever holds it now. With no pick
        // row for this seat the team keeps it, which is what a league that has
        // not generated picks yet expects.
        teamId: pick ? pick.currentTeamId : slot.teamId,
        draftPickId: pick?.id ?? null,
      };
    });

    const overalls = new Set(slots.map((slot) => slot.overall));
    if (overalls.size !== slots.length) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Two picks were given the same place in the order.',
      );
    }

    // A draft that has started keeps what has already been picked: replacing
    // the order would erase it.
    const picked = await this.prisma.draftOrderSlot.count({
      where: { draftId: draft.id, playerId: { not: null } },
    });
    if (picked > 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This draft has already started, so its order can no longer be replaced.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.draftOrderSlot.deleteMany({ where: { draftId: draft.id } }),
      this.prisma.draftOrderSlot.createMany({ data: slots }),
    ]);

    return this.get(leagueId, kind);
  }

  /**
   * Builds the order from the team list: every round laid out from one team
   * order, snaked or straight. `randomize` shuffles the first round first,
   * which is what the page's Randomize button asks for.
   */
  async buildOrder(
    leagueId: number,
    kind: DraftKind,
    options: { randomize: boolean },
  ) {
    const draft = await this.ensureDraft(leagueId, kind);

    const existing = await this.prisma.draftOrderSlot.findMany({
      where: { draftId: draft.id, round: 1 },
      orderBy: { overall: 'asc' },
      select: {
        teamId: true,
        draftPick: { select: { originalTeamId: true } },
      },
    });

    let teamIds: number[];
    if (existing.length > 0 && !options.randomize) {
      // Keep the first round the commissioner already set and rebuild the
      // later rounds around it. The seat is what is kept, not the picker: a
      // traded pick would otherwise give one team two seats and another none.
      teamIds = existing.map(
        (slot) => slot.draftPick?.originalTeamId ?? slot.teamId,
      );
    } else {
      const teams = await this.prisma.team.findMany({
        where: { leagueId },
        select: { id: true },
        orderBy: { name: 'asc' },
      });
      teamIds = teams.map((team) => team.id);
    }

    if (teamIds.length === 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This league has no teams yet, so there is no order to build.',
      );
    }

    if (options.randomize) {
      // Fisher-Yates, so every order is equally likely. A sort with a random
      // comparator is not a shuffle and favours the original order.
      for (let i = teamIds.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [teamIds[i], teamIds[j]] = [teamIds[j], teamIds[i]];
      }
    }

    const movedPicks = await this.prisma.draftPick.findMany({
      where: {
        leagueId,
        seasonStartYear: draft.seasonStartYear,
        round: 1,
        movedToEndOfRound: true,
      },
      select: { originalTeamId: true },
    });

    const built = buildDraftOrder(teamIds, {
      rounds: draft.rounds,
      format: draft.format,
      reversalRound: draft.reversalRound,
      movedToEndOfFirstRound: movedPicks.map((pick) => pick.originalTeamId),
    });

    return this.setOrder(leagueId, kind, {
      order: built.map((slot) => ({
        round: slot.round,
        pickInRound: slot.pickInRound,
        overall: slot.overall,
        teamId: slot.teamId,
      })),
    });
  }

  /**
   * Who is still available to draft.
   *
   * A startup draft runs through every active NBA player; a rookie draft only
   * through the class that entered in this league year. Either way, a player
   * already on a roster in this league is out of the pool.
   */
  private poolWhere(
    kind: DraftKind,
    seasonStartYear: number,
  ): Prisma.PlayerWhereInput {
    if (kind === DraftKind.rookie) {
      return { isActive: true, draftYear: seasonStartYear };
    }
    return { isActive: true };
  }

  private async poolCounts(
    leagueId: number,
    kind: DraftKind,
    seasonStartYear: number,
  ) {
    const where = this.poolWhere(kind, seasonStartYear);

    const [total, taken] = await Promise.all([
      this.prisma.player.count({ where }),
      this.prisma.leaguePlayer.count({
        // On a roster, which is what takes a player out of the pool. A waived
        // or free-agent row is a player this league has seen, not one it holds.
        where: { leagueId, teamId: { not: null }, player: where },
      }),
    ]);

    return {
      total,
      drafted: taken,
      available: Math.max(total - taken, 0),
      // balldontlie's contract endpoints are not synced yet, so a startup
      // player's salary has no source and the column is left empty rather
      // than filled with a number nobody chose.
      contractSource:
        kind === DraftKind.startup ? 'balldontlie' : 'rookieScale',
      contractsAvailable: false,
    };
  }

  async pool(leagueId: number, kind: DraftKind, query: ListPoolDto) {
    const draft = await this.ensureDraft(leagueId, kind);
    const base = this.poolWhere(kind, draft.seasonStartYear);

    const search = query.search?.trim();
    const where: Prisma.PlayerWhereInput = {
      ...base,
      ...(search
        ? { name: { contains: search, mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(query.includeDrafted
        ? {}
        : {
            leaguePlayers: {
              none: { leagueId, teamId: { not: null } },
            },
          }),
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? POOL_PAGE_SIZE;

    const [total, players] = await Promise.all([
      this.prisma.player.count({ where }),
      this.prisma.player.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          position: true,
          birthdate: true,
          draftYear: true,
          draftRound: true,
          draftNumber: true,
          yearsOfService: true,
          headshot: true,
          nbaTeam: { select: { id: true, abbreviation: true, name: true } },
          leaguePlayers: {
            where: { leagueId, teamId: { not: null } },
            select: { id: true, team: { select: { id: true, abbr: true } } },
            take: 1,
          },
        },
      }),
    ]);

    // A draft is picked on what a player just did, so the board carries
    // last season's line. One lookup for the page rather than one per row.
    const statsSeason = await this.playerStats.seasonForDraft(
      draft.seasonStartYear,
    );
    const averages = statsSeason
      ? await this.playerStats.seasonAverages(
          players.map((player) => player.id),
          statsSeason,
        )
      : new Map<number, SeasonAverage>();

    return {
      page,
      limit,
      total,
      // Null when no lines have been synced for the season, which is what a
      // league sees before a backfill. The column is left empty rather than
      // filled with zeros that read as a bad player.
      statsSeason,
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
        position: player.position,
        // Worked out when shown, never stored: a birthday does not change but
        // an age does. Null until a Super Admin has imported the birthdate.
        age: ageFrom(player.birthdate),
        nbaTeam: player.nbaTeam,
        draftYear: player.draftYear,
        draftRound: player.draftRound,
        draftNumber: player.draftNumber,
        yearsOfService: player.yearsOfService,
        headshot: player.headshot,
        takenBy: player.leaguePlayers[0]?.team ?? null,
        // No global contract table yet, so there is nothing honest to put
        // here. The client's answers have startup contracts coming from the
        // same API as the player sync.
        contract: null,
        stats: averages.get(player.id) ?? null,
      })),
    };
  }
}

/** Whole years between a birthdate and today, in UTC so it cannot drift. */
function ageFrom(birthdate: Date | null): number | null {
  if (!birthdate) return null;

  const today = new Date();
  let age = today.getUTCFullYear() - birthdate.getUTCFullYear();

  const monthDiff = today.getUTCMonth() - birthdate.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getUTCDate() < birthdate.getUTCDate())
  ) {
    age -= 1;
  }

  return age;
}
