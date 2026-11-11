import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  DraftKind,
  DraftStatus,
  LeaguePlayerStatus,
  Prisma,
  RosterSlotType,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { CapService } from '../cap/cap.service';
import { PlayerStatsService } from '../nba/player-stats.service';

/**
 * The live draft room: making a pick, the clock, and auto-pick when it runs
 * out.
 *
 * Everything the commissioner sets — rounds, format, the order, the timer —
 * already exists in `DraftService`. This is the part that runs while people
 * are watching.
 *
 * Two decisions shape the whole file.
 *
 * **The clock is derived, never stored.** A pick's deadline is the previous
 * pick's `pickedAt` plus `pickSeconds`, and the draft's `startedAt` for the
 * first one. Nothing writes a countdown to the database, so nothing can
 * disagree with it: a reload, a second browser and the server all compute the
 * same deadline from the same two columns.
 *
 * **Expiry is settled on read, not by a timer.** Whoever loads the board
 * first makes the picks whose clocks have already run out, inside one
 * transaction. A cron job that is late — or dead — would leave a draft frozen
 * with nobody able to do anything; this way the draft cannot stall for longer
 * than it takes somebody to open the page. It is the same approach
 * `settle.service.ts` takes to a fantasy week, and for the same reason.
 */

/**
 * How many expired picks one read will make before giving up.
 *
 * A draft abandoned overnight has every remaining clock expired, and making
 * three hundred picks inside one request would time out. The bound keeps a
 * single read fast; the next read continues from where this one stopped.
 */
const MAX_AUTO_PICKS_PER_READ = 25;

/** A player the auto-pick can take, ordered best-first by last season. */
type Candidate = { id: number; name: string; score: number };

@Injectable()
export class DraftLiveService {
  private readonly logger = new Logger(DraftLiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capService: CapService,
    private readonly playerStats: PlayerStatsService,
  ) {}

  /**
   * The draft a league is running, with its order and its pool state.
   *
   * Throws rather than creating one: `DraftService.get` is what brings a draft
   * into being, and the room is only ever opened from a page that has already
   * read it.
   */
  private async loadDraft(leagueId: number, kind: DraftKind) {
    const draft = await this.prisma.leagueDraft.findFirst({
      where:
        kind === DraftKind.startup ? { leagueId, kind } : { leagueId, kind },
      orderBy: { seasonStartYear: 'desc' },
    });
    if (!draft) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'This league has no draft of that kind yet.',
      );
    }
    return draft;
  }

  /**
   * Opens the room. Commissioner only, and only once.
   *
   * Refuses an order that is not finished, because a draft whose slots run out
   * half way through has no next pick to hand the clock to — and the
   * commissioner setting the order is Rule 12.4, a deliberate step.
   */
  async start(leagueId: number, kind: DraftKind) {
    const draft = await this.loadDraft(leagueId, kind);

    if (draft.status === DraftStatus.complete) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'This draft is already over.');
    }
    if (draft.status === DraftStatus.inProgress) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This draft is already running.',
      );
    }

    const [slots, teams] = await Promise.all([
      this.prisma.draftOrderSlot.count({ where: { draftId: draft.id } }),
      this.prisma.team.count({ where: { leagueId } }),
    ]);

    if (slots === 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Set the draft order before starting the draft.',
      );
    }

    const expected = teams * draft.rounds;
    if (slots < expected) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `The order has ${slots} picks but this draft needs ${expected}. Finish the order before starting.`,
      );
    }

    await this.prisma.leagueDraft.update({
      where: { id: draft.id },
      data: { status: DraftStatus.inProgress, startedAt: new Date() },
    });

    return this.board(leagueId, kind);
  }

  /**
   * Everything the room draws, after settling any pick whose clock has run
   * out.
   *
   * One read for the whole screen: the board grid, the clock, who is on the
   * clock, whether it is you, and the picks already made.
   */
  async board(leagueId: number, kind: DraftKind, userId?: number) {
    let draft = await this.loadDraft(leagueId, kind);

    if (draft.status === DraftStatus.inProgress) {
      const made = await this.settleExpired(draft.id);
      // Only re-read when something actually changed.
      if (made > 0) {
        draft = await this.loadDraft(leagueId, kind);
      }
    }

    const [slots, myMembership] = await Promise.all([
      this.prisma.draftOrderSlot.findMany({
        where: { draftId: draft.id },
        orderBy: { overall: 'asc' },
        select: {
          id: true,
          round: true,
          pickInRound: true,
          overall: true,
          teamId: true,
          pickedAt: true,
          team: { select: { id: true, name: true, abbr: true, logo: true } },
          player: {
            select: {
              id: true,
              name: true,
              position: true,
              headshot: true,
              nbaTeam: { select: { abbreviation: true } },
            },
          },
        },
      }),
      userId === undefined
        ? Promise.resolve(null)
        : this.prisma.teamMember.findFirst({
            where: { leagueId, userId },
            select: { teamId: true },
          }),
    ]);

    const current = slots.find((slot) => slot.pickedAt === null) ?? null;
    const previous = current
      ? ([...slots]
          .filter((slot) => slot.overall < current.overall && slot.pickedAt)
          .pop() ?? null)
      : null;

    const deadline =
      draft.status === DraftStatus.inProgress && current
        ? this.deadlineFor(draft, previous?.pickedAt ?? null)
        : null;

    const myTeamId = myMembership?.teamId ?? null;

    return {
      id: draft.id,
      kind: draft.kind,
      seasonStartYear: draft.seasonStartYear,
      status: draft.status,
      rounds: draft.rounds,
      format: draft.format,
      reversalRound: draft.reversalRound,
      pickSeconds: draft.pickSeconds,
      startsAt: draft.startsAt,
      startedAt: draft.startedAt,
      timezone: draft.timezone,

      myTeamId,

      /**
       * The clock. `deadline` is an instant, so the browser counts down
       * against its own wall clock rather than trusting a number of seconds
       * that goes stale the moment the response is sent. `serverNow` is there
       * so a browser whose clock is wrong can correct for the offset.
       */
      serverNow: new Date(),
      deadline,

      onTheClock: current
        ? {
            slotId: current.id,
            round: current.round,
            pickInRound: current.pickInRound,
            overall: current.overall,
            team: current.team,
            isMine: myTeamId !== null && current.teamId === myTeamId,
          }
        : null,

      picks: slots.map((slot) => ({
        id: slot.id,
        round: slot.round,
        pickInRound: slot.pickInRound,
        overall: slot.overall,
        team: slot.team,
        player: slot.player,
        pickedAt: slot.pickedAt,
        isMine: myTeamId !== null && slot.teamId === myTeamId,
      })),

      made: slots.filter((slot) => slot.pickedAt !== null).length,
      total: slots.length,
    };
  }

  /**
   * When the team on the clock runs out of time.
   *
   * `previousPickedAt` is null for the very first pick of the draft, which
   * runs from `startedAt`. A draft with neither — started by a route that
   * does not set it — gets no deadline at all rather than one in 1970, so the
   * clock simply does not run until somebody starts the draft properly.
   */
  private deadlineFor(
    draft: { startedAt: Date | null; pickSeconds: number },
    previousPickedAt: Date | null,
  ): Date | null {
    const anchor = previousPickedAt ?? draft.startedAt;
    if (!anchor) return null;

    return new Date(anchor.getTime() + draft.pickSeconds * 1000);
  }

  /**
   * Makes the picks whose clocks have already run out, oldest first.
   *
   * Returns how many it made. Each one is its own transaction: a draft left
   * alone for an hour owes several picks, and one failing on the fourth should
   * not undo the three that were legal.
   */
  private async settleExpired(draftId: number): Promise<number> {
    let made = 0;

    while (made < MAX_AUTO_PICKS_PER_READ) {
      const draft = await this.prisma.leagueDraft.findUnique({
        where: { id: draftId },
      });
      if (!draft || draft.status !== DraftStatus.inProgress) break;

      const [current, previous] = await Promise.all([
        this.prisma.draftOrderSlot.findFirst({
          where: { draftId, pickedAt: null },
          orderBy: { overall: 'asc' },
          select: {
            id: true,
            overall: true,
            teamId: true,
            round: true,
            pickInRound: true,
          },
        }),
        this.prisma.draftOrderSlot.findFirst({
          where: { draftId, pickedAt: { not: null } },
          orderBy: { overall: 'desc' },
          select: { pickedAt: true },
        }),
      ]);
      if (!current) break;

      const deadline = this.deadlineFor(draft, previous?.pickedAt ?? null);
      if (!deadline || deadline.getTime() > Date.now()) break;

      const candidate = await this.bestAvailable(
        draft.leagueId,
        draft.kind,
        draft.seasonStartYear,
      );
      if (!candidate) {
        // Nothing left to draft. Ending it is more honest than leaving a room
        // open on an empty pool with a clock nobody can answer.
        await this.prisma.leagueDraft.update({
          where: { id: draftId },
          data: { status: DraftStatus.complete },
        });
        break;
      }

      try {
        await this.commitPick({
          draftId,
          slotId: current.id,
          playerId: candidate.id,
          auto: true,
        });
        made += 1;
      } catch (error) {
        // An auto-pick that cannot be made must not take the whole board down
        // with it: the room is being read, and the reader is not at fault.
        this.logger.error(
          `Auto-pick failed on draft ${draftId}, slot ${current.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
        break;
      }
    }

    return made;
  }

  /**
   * Who the clock gives the pick to.
   *
   * Last completed season's points per game, which is the column the board
   * itself is sorted on, so an auto-pick takes the player the owner would
   * most likely have taken. A player with no synced lines has no score and
   * comes last — before a backfill that is everybody, and then it falls back
   * to the board's own alphabetical order, which is at least not random.
   */
  private async bestAvailable(
    leagueId: number,
    kind: DraftKind,
    seasonStartYear: number,
  ): Promise<Candidate | null> {
    const where: Prisma.PlayerWhereInput = {
      isActive: true,
      ...(kind === DraftKind.rookie ? { draftYear: seasonStartYear } : {}),
      // Held by a team in this league, by contract or by rights, is what takes
      // a player out of the pool.
      leaguePlayers: { none: { leagueId, teamId: { not: null } } },
    };

    const players = await this.prisma.player.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, name: true },
      // Enough that the best available is almost certainly inside it, without
      // pulling four hundred rows to award one pick.
      take: 200,
    });
    if (players.length === 0) return null;

    const statsSeason = await this.playerStats.seasonForDraft(seasonStartYear);
    if (!statsSeason) {
      return { id: players[0].id, name: players[0].name, score: 0 };
    }

    const averages = await this.playerStats.seasonAverages(
      players.map((player) => player.id),
      statsSeason,
    );

    let best: Candidate = {
      id: players[0].id,
      name: players[0].name,
      score: averages.get(players[0].id)?.pts ?? -1,
    };
    for (const player of players.slice(1)) {
      const score = averages.get(player.id)?.pts ?? -1;
      if (score > best.score) {
        best = { id: player.id, name: player.name, score };
      }
    }

    return best;
  }

  /**
   * An owner (or the commissioner, on their behalf) takes a player.
   *
   * Expired clocks are settled first, so a pick sent a second after the buzzer
   * is refused by the auto-pick that already happened rather than sneaking in
   * ahead of it.
   */
  async pick(
    leagueId: number,
    kind: DraftKind,
    playerId: number,
    userId: number,
    isCommissioner: boolean,
  ) {
    const draft = await this.loadDraft(leagueId, kind);

    if (draft.status !== DraftStatus.inProgress) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        draft.status === DraftStatus.complete
          ? 'This draft is over.'
          : 'This draft has not started yet.',
      );
    }

    await this.settleExpired(draft.id);

    const current = await this.prisma.draftOrderSlot.findFirst({
      where: { draftId: draft.id, pickedAt: null },
      orderBy: { overall: 'asc' },
      select: { id: true, teamId: true, round: true, pickInRound: true },
    });
    if (!current) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Every pick has been made.');
    }

    if (!isCommissioner) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { leagueId, userId },
        select: { teamId: true },
      });
      if (!membership || membership.teamId !== current.teamId) {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'It is not your turn to pick.',
        );
      }
    }

    await this.commitPick({
      draftId: draft.id,
      slotId: current.id,
      playerId,
      auto: false,
    });

    return this.board(leagueId, kind, userId);
  }

  /**
   * Writes one pick, and everything that follows from it, in one transaction.
   *
   * What a pick actually means differs by kind, and the rule book is explicit
   * about it:
   *
   * **A startup pick is a roster move.** The teams are dividing the existing
   * NBA between them, so the player joins the roster. He has no contract,
   * because balldontlie's contract endpoints are not synced — which is what
   * the pool already reports as `contractsAvailable: false` — and a salary
   * nobody chose would be worse than an empty column.
   *
   * **A rookie pick is a rights claim, not a signing.** Rule 11.8: a drafted
   * first-rounder carries a cap hold equal to his Year 1 scale salary, counts
   * in Team Salary from the moment he is drafted, takes no roster spot, and
   * must be signed or released by the rookie signing deadline. Rule 11.13:
   * a second-rounder carries no hold at all. So the pick writes `rightsHeld`
   * and, for the first round, the hold — and the contract itself is Article
   * 11's job, where the owner's 3-year / 4-year / two-way choice (Rule 11.10)
   * belongs.
   */
  private async commitPick(input: {
    draftId: number;
    slotId: number;
    playerId: number;
    auto: boolean;
  }) {
    const { draftId, slotId, playerId, auto } = input;

    const draft = await this.prisma.leagueDraft.findUnique({
      where: { id: draftId },
      select: {
        id: true,
        leagueId: true,
        kind: true,
        seasonStartYear: true,
      },
    });
    if (!draft) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Draft not found.');
    }

    const slot = await this.prisma.draftOrderSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        teamId: true,
        round: true,
        pickInRound: true,
        draftPickId: true,
        pickedAt: true,
      },
    });
    if (!slot) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Draft slot not found.');
    }
    if (slot.pickedAt !== null) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'That pick has already been made.',
      );
    }

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true, name: true, isActive: true, draftYear: true },
    });
    if (!player) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Player not found.');
    }
    if (!player.isActive) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${player.name} is not an active player.`,
      );
    }
    if (
      draft.kind === DraftKind.rookie &&
      player.draftYear !== draft.seasonStartYear
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${player.name} is not in this year's rookie class.`,
      );
    }

    // Already held by somebody in this league — by contract or by rights —
    // is what takes a player out of the pool.
    const held = await this.prisma.leaguePlayer.findFirst({
      where: { leagueId: draft.leagueId, playerId, teamId: { not: null } },
      select: { team: { select: { name: true } } },
    });
    if (held) {
      throw new AppError(
        HttpStatus.CONFLICT,
        `${player.name} is already held by ${held.team?.name ?? 'another team'}.`,
      );
    }

    const isRookie = draft.kind === DraftKind.rookie;

    // Rule 11.8 — a drafted rookie takes no roster spot, so only a startup
    // pick has to fit. Checked against the league's own maximum.
    if (!isRookie) {
      const [settings, rostered] = await Promise.all([
        this.prisma.leagueSettings.findUnique({
          where: { leagueId: draft.leagueId },
          select: { maxRosterSize: true },
        }),
        this.prisma.leaguePlayer.count({
          where: {
            leagueId: draft.leagueId,
            teamId: slot.teamId,
            status: LeaguePlayerStatus.rostered,
            slotType: { not: RosterSlotType.twoWay },
          },
        }),
      ]);

      if (settings && rostered >= settings.maxRosterSize) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          `This roster is full at ${settings.maxRosterSize} players.`,
        );
      }
    }

    // Rule 11.9 — the hold is the slot's Year 1 scale salary, and the scale
    // only covers the thirty first-round slots. Read before the transaction
    // because it needs the league's effective cap, which is its own set of
    // queries.
    let holdAmount: number | null = null;
    if (isRookie && slot.round === 1) {
      const [scale, cap] = await Promise.all([
        this.prisma.rookieScaleSlot.findUnique({
          where: { pick: slot.pickInRound },
        }),
        this.capService.forLeague(draft.leagueId, draft.seasonStartYear),
      ]);

      if (scale && cap.salaryCap > 0) {
        holdAmount = Math.round(
          (cap.salaryCap * scale.year1PercentOfCap) / 100,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Claiming the slot first, and only when it is still unpicked, is what
      // makes two owners clicking at the same moment safe: the second update
      // matches no row and is refused.
      const claimed = await tx.draftOrderSlot.updateMany({
        where: { id: slot.id, pickedAt: null },
        data: { playerId, pickedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'That pick was just made by somebody else.',
        );
      }

      // A row may already exist for a player this league has seen before —
      // waived, or a free agent — so this moves that row rather than
      // refusing on the unique key.
      const leaguePlayer = await tx.leaguePlayer.upsert({
        where: {
          leagueId_playerId: { leagueId: draft.leagueId, playerId },
        },
        create: {
          leagueId: draft.leagueId,
          playerId,
          teamId: slot.teamId,
          status: isRookie
            ? LeaguePlayerStatus.rightsHeld
            : LeaguePlayerStatus.rostered,
          slotType: RosterSlotType.standard,
        },
        update: {
          teamId: slot.teamId,
          status: isRookie
            ? LeaguePlayerStatus.rightsHeld
            : LeaguePlayerStatus.rostered,
          slotType: RosterSlotType.standard,
        },
        select: { id: true },
      });

      if (holdAmount !== null) {
        await tx.capHold.upsert({
          where: {
            leaguePlayerId_seasonStartYear: {
              leaguePlayerId: leaguePlayer.id,
              seasonStartYear: draft.seasonStartYear,
            },
          },
          create: {
            leagueId: draft.leagueId,
            teamId: slot.teamId,
            leaguePlayerId: leaguePlayer.id,
            seasonStartYear: draft.seasonStartYear,
            amount: holdAmount,
          },
          update: { teamId: slot.teamId, amount: holdAmount },
        });
      }

      // Rule 8.11 — a used pick leaves the inventory, so it can no longer be
      // traded, protected or frozen.
      if (slot.draftPickId) {
        await tx.draftPick.update({
          where: { id: slot.draftPickId },
          data: { usedAt: new Date() },
        });
      }

      const remaining = await tx.draftOrderSlot.count({
        where: { draftId: draft.id, pickedAt: null },
      });
      if (remaining === 0) {
        await tx.leagueDraft.update({
          where: { id: draft.id },
          data: { status: DraftStatus.complete },
        });
      }
    });

    if (auto) {
      this.logger.log(
        `Draft ${draft.id}: clock expired, auto-picked ${player.name} at overall slot ${slot.id}`,
      );
    }
  }
}
