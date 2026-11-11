import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CalendarPhase,
  ContractSource,
  ContractType,
  FreeAgencyOfferStatus,
  GuaranteeType,
  LeaguePlayerStatus,
  Prisma,
  RosterSlotType,
  SignedVia,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { CapService } from '../cap/cap.service';
import { SubmitOfferDto } from './dto/submit-offer.dto';
import {
  birdRightsOf,
  checkOffer,
  OfferCheck,
  offerIsLegal,
  offerSeasons,
  offerTotalValue,
  OfferTerms,
} from './free-agency.rules';

const OFFER_SELECT = {
  id: true,
  teamId: true,
  leaguePlayerId: true,
  years: true,
  firstYearSalary: true,
  raisePct: true,
  contractType: true,
  signedVia: true,
  guaranteedAmounts: true,
  status: true,
  checks: true,
  expiresAt: true,
  respondedAt: true,
  createdAt: true,
  team: {
    select: { id: true, name: true, abbr: true, color: true, logo: true },
  },
  offeredBy: { select: { id: true, name: true } },
  leaguePlayer: {
    select: {
      id: true,
      status: true,
      birdYears: true,
      teamId: true,
      team: { select: { id: true, name: true, abbr: true } },
      player: { select: { id: true, name: true, position: true } },
    },
  },
} satisfies Prisma.FreeAgencyOfferSelect;

type OfferRow = Prisma.FreeAgencyOfferGetPayload<{
  select: typeof OFFER_SELECT;
}>;

const money = (value: number) => `${Math.round(value).toLocaleString('en-US')}`;

/**
 * What a signed season is guaranteed for.
 *
 * Rule 10.1 lets a contract be non-guaranteed, and Rule 10.14 reads exactly
 * this field to work out what releasing the player costs. Writing `full` for
 * every signing — which is what happened before — made a non-guaranteed deal
 * cost its whole remaining value to walk away from.
 */
function guaranteeFor(contractType: ContractType): GuaranteeType {
  return contractType === ContractType.nonGuaranteed
    ? GuaranteeType.none
    : GuaranteeType.full;
}

/**
 * What one signed season is guaranteed for.
 *
 * A partial guarantee names a figure per season, so the year carries both the
 * type and the amount; everything else is decided by the contract type alone
 * and stores no amount. A season of a partial deal guaranteed for its whole
 * salary is written as `full`, and one guaranteed for nothing as `none`:
 * `owedFor` in the waive service reads the type first, and a `partial` year
 * carrying its own salary would be the same obligation described two ways.
 */
function guaranteeForSeason(
  offer: { contractType: ContractType; guaranteedAmounts: number[] },
  index: number,
): { guaranteeType: GuaranteeType; guaranteedAmount: number | null } {
  if (offer.contractType !== ContractType.partiallyGuaranteed) {
    return {
      guaranteeType: guaranteeFor(offer.contractType),
      guaranteedAmount: null,
    };
  }

  const amount = offer.guaranteedAmounts[index] ?? 0;
  if (amount <= 0) {
    return { guaranteeType: GuaranteeType.none, guaranteedAmount: null };
  }

  return {
    guaranteeType: GuaranteeType.partial,
    guaranteedAmount: amount,
  };
}

/**
 * Checks a partial guarantee against the salaries it is attached to.
 *
 * Returns an empty list for every other contract type, so the column says
 * "nothing was named" rather than repeating what the type already decides.
 */
function partialGuarantees(
  terms: OfferTerms,
  input: number[] | undefined,
  startSeasonStartYear: number,
): number[] {
  if (terms.contractType !== ContractType.partiallyGuaranteed) return [];

  if (!input || input.length !== terms.years) {
    throw new AppError(
      HttpStatus.BAD_REQUEST,
      `A partially guaranteed offer needs one guaranteed amount per season — ${terms.years} of them.`,
    );
  }

  const seasons = offerSeasons(terms, startSeasonStartYear);

  for (const [index, amount] of input.entries()) {
    const season = seasons[index];
    if (amount > season.salary) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `The ${season.seasonStartYear} guarantee of ${money(amount)} is more than that season's salary of ${money(season.salary)}.`,
      );
    }
  }

  // Guaranteeing every season in full is a standard contract wearing another
  // name, and the two would then behave identically on a release.
  if (input.every((amount, index) => amount === seasons[index].salary)) {
    throw new AppError(
      HttpStatus.BAD_REQUEST,
      'Every season is guaranteed in full, which is a standard contract. Offer it as standard instead.',
    );
  }

  return input;
}

@Injectable()
export class FreeAgencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capService: CapService,
  ) {}

  async list(leagueId: number, status?: FreeAgencyOfferStatus) {
    const [league, offers] = await Promise.all([
      this.leagueState(leagueId),
      this.prisma.freeAgencyOffer.findMany({
        where: { leagueId, ...(status ? { status } : {}) },
        select: OFFER_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      seasonStartYear: league.seasonStartYear,
      windowOpen: league.windowOpen,
      window: league.window,
      freeAgencyStyle: league.freeAgencyStyle,
      offers: offers.map((offer) => this.toOffer(offer)),
    };
  }

  /**
   * Puts an offer on a free agent, or replaces the one this team already has.
   *
   * An illegal offer is stored rather than refused. The commissioner is the
   * one who decides what to do about it, and an offer that silently never
   * appeared would be harder to argue about than one marked as failing.
   */
  async submit(
    leagueId: number,
    teamId: number,
    userId: number,
    payload: SubmitOfferDto,
  ) {
    const league = await this.leagueState(leagueId);

    const target = await this.prisma.leaguePlayer.findFirst({
      where: { id: payload.leaguePlayerId, leagueId },
      select: {
        id: true,
        status: true,
        teamId: true,
        player: { select: { name: true } },
      },
    });
    if (!target) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'That player is not in this league.',
      );
    }

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true },
    });
    if (!team) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Team not found');
    }

    const terms: OfferTerms = {
      years: payload.years,
      firstYearSalary: payload.firstYearSalary,
      raisePct: payload.raisePct ?? 0,
      contractType: payload.contractType ?? ContractType.standard,
      signedVia: payload.signedVia ?? SignedVia.capSpace,
    };

    // Rule 10.1 — a partial guarantee is named season by season, and Rule
    // 10.14 pays out exactly what is named here when the player is released.
    const guaranteedAmounts = partialGuarantees(
      terms,
      payload.guaranteedAmounts,
      league.seasonStartYear,
    );

    const context = await this.contextFor(leagueId, teamId, league);
    const checks = checkOffer(terms, {
      ...context,
      playerIsFree: target.status !== LeaguePlayerStatus.rostered,
    });

    const offer = await this.prisma.freeAgencyOffer.upsert({
      where: {
        leaguePlayerId_teamId: { leaguePlayerId: target.id, teamId },
      },
      create: {
        leagueId,
        leaguePlayerId: target.id,
        teamId,
        offeredById: userId,
        years: terms.years,
        firstYearSalary: terms.firstYearSalary,
        raisePct: terms.raisePct,
        contractType: terms.contractType,
        signedVia: terms.signedVia,
        guaranteedAmounts,
        checks: checks as unknown as Prisma.InputJsonValue,
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
      },
      update: {
        offeredById: userId,
        years: terms.years,
        firstYearSalary: terms.firstYearSalary,
        raisePct: terms.raisePct,
        contractType: terms.contractType,
        signedVia: terms.signedVia,
        // Replaced outright rather than merged: a re-bid over fewer years
        // would otherwise keep guarantees for seasons that no longer exist.
        guaranteedAmounts: { set: guaranteedAmounts },
        // Raising a bid revives a withdrawn offer rather than leaving a dead
        // row beside a live one.
        status: FreeAgencyOfferStatus.pending,
        respondedAt: null,
        checks: checks as unknown as Prisma.InputJsonValue,
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
      },
      select: OFFER_SELECT,
    });

    return this.toOffer(offer);
  }

  async withdraw(leagueId: number, offerId: number) {
    const offer = await this.findOffer(leagueId, offerId);
    if (offer.status !== FreeAgencyOfferStatus.pending) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Only an offer that is still pending can be withdrawn.',
      );
    }

    const updated = await this.prisma.freeAgencyOffer.update({
      where: { id: offerId },
      data: {
        status: FreeAgencyOfferStatus.withdrawn,
        respondedAt: new Date(),
      },
      select: OFFER_SELECT,
    });
    return this.toOffer(updated);
  }

  async decline(leagueId: number, offerId: number) {
    const offer = await this.findOffer(leagueId, offerId);
    if (offer.status !== FreeAgencyOfferStatus.pending) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Only a pending offer can be declined.',
      );
    }

    const updated = await this.prisma.freeAgencyOffer.update({
      where: { id: offerId },
      data: {
        status: FreeAgencyOfferStatus.declined,
        respondedAt: new Date(),
      },
      select: OFFER_SELECT,
    });
    return this.toOffer(updated);
  }

  /**
   * Signs the player. This is the only place in free agency that writes a
   * contract, so it is the only place that has to be a transaction: the
   * contract, the roster move and every rival offer settle together or not at
   * all.
   */
  async accept(leagueId: number, offerId: number) {
    const offer = await this.findOffer(leagueId, offerId);
    if (offer.status !== FreeAgencyOfferStatus.pending) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Only a pending offer can be accepted.',
      );
    }

    const league = await this.leagueState(leagueId);
    const terms: OfferTerms = {
      years: offer.years,
      firstYearSalary: offer.firstYearSalary,
      raisePct: offer.raisePct,
      contractType: offer.contractType,
      signedVia: offer.signedVia,
    };
    const isTwoWay = offer.contractType === ContractType.twoWay;
    const seasons = offerSeasons(terms, league.seasonStartYear);

    await this.prisma.$transaction(async (tx) => {
      // A free agent can hold an old, finished contract. It is marked inactive
      // rather than deleted, because the Previous Contracts tab reads it.
      await tx.contract.updateMany({
        where: { leaguePlayerId: offer.leaguePlayerId, isActive: true },
        data: { isActive: false },
      });

      await tx.contract.create({
        data: {
          leagueId,
          leaguePlayerId: offer.leaguePlayerId,
          teamId: offer.teamId,
          contractType: offer.contractType,
          signedVia: offer.signedVia,
          source: ContractSource.signing,
          signedSeasonStartYear: league.seasonStartYear,
          startSeasonStartYear: seasons[0].seasonStartYear,
          endSeasonStartYear: seasons[seasons.length - 1].seasonStartYear,
          years: {
            create: seasons.map((season, index) => ({
              seasonStartYear: season.seasonStartYear,
              salary: isTwoWay ? 0 : season.salary,
              capHit: isTwoWay ? 0 : season.salary,
              ...guaranteeForSeason(offer, index),
            })),
          },
        },
      });

      await tx.leaguePlayer.update({
        where: { id: offer.leaguePlayerId },
        data: {
          teamId: offer.teamId,
          status: LeaguePlayerStatus.rostered,
          slotType: isTwoWay ? RosterSlotType.twoWay : RosterSlotType.standard,
        },
      });

      // Signing elsewhere ends the cap hold the old team was carrying.
      await tx.capHold.deleteMany({
        where: { leaguePlayerId: offer.leaguePlayerId },
      });

      await tx.freeAgencyOffer.update({
        where: { id: offerId },
        data: {
          status: FreeAgencyOfferStatus.accepted,
          respondedAt: new Date(),
        },
      });

      // Everyone else who bid has lost. Leaving them pending would let a
      // second offer be accepted on a player who is no longer available.
      await tx.freeAgencyOffer.updateMany({
        where: {
          leaguePlayerId: offer.leaguePlayerId,
          status: FreeAgencyOfferStatus.pending,
          id: { not: offerId },
        },
        data: {
          status: FreeAgencyOfferStatus.declined,
          respondedAt: new Date(),
        },
      });
    });

    const updated = await this.prisma.freeAgencyOffer.findUniqueOrThrow({
      where: { id: offerId },
      select: OFFER_SELECT,
    });
    return this.toOffer(updated);
  }

  /**
   * Who a team can sign, and what it has to spend.
   *
   * Free agency holds two kinds of player: one nobody has a claim on, and one
   * whose former team still holds his rights. They are listed together because
   * a team shopping does not care about the difference until it bids, but the
   * list says which is which, because bidding on the second makes him a
   * restricted free agent.
   */
  async pool(leagueId: number, teamId?: number) {
    const league = await this.leagueState(leagueId);

    const players = await this.prisma.leaguePlayer.findMany({
      where: {
        leagueId,
        status: {
          in: [LeaguePlayerStatus.freeAgent, LeaguePlayerStatus.rightsHeld],
        },
      },
      select: {
        id: true,
        status: true,
        birdYears: true,
        teamId: true,
        team: { select: { id: true, name: true, abbr: true } },
        player: {
          select: {
            id: true,
            name: true,
            position: true,
            yearsOfService: true,
            yearsOfServiceEstimated: true,
            nbaTeam: { select: { abbreviation: true } },
          },
        },
        contracts: {
          select: {
            endSeasonStartYear: true,
            years: { select: { salary: true, seasonStartYear: true } },
          },
          orderBy: { endSeasonStartYear: 'desc' },
          take: 1,
        },
        faOffers: {
          where: { status: FreeAgencyOfferStatus.pending },
          select: {
            id: true,
            teamId: true,
            years: true,
            firstYearSalary: true,
            raisePct: true,
            contractType: true,
            signedVia: true,
            guaranteedAmounts: true,
            expiresAt: true,
            createdAt: true,
            team: { select: { id: true, name: true, abbr: true, color: true } },
          },
          orderBy: { firstYearSalary: 'desc' },
        },
      },
      orderBy: { player: { lastName: 'asc' } },
    });

    const team = teamId ? await this.teamState(leagueId, teamId, league) : null;

    return {
      seasonStartYear: league.seasonStartYear,
      windowOpen: league.windowOpen,
      window: league.window,
      freeAgencyStyle: league.freeAgencyStyle,
      team,
      players: players.map((row) => {
        const last = row.contracts[0] ?? null;
        const lastSalary =
          last?.years.find((y) => y.seasonStartYear === last.endSeasonStartYear)
            ?.salary ?? null;

        return {
          leaguePlayerId: row.id,
          playerId: row.player.id,
          name: row.player.name,
          position: row.player.position,
          nbaTeam: row.player.nbaTeam?.abbreviation ?? null,
          experience: row.player.yearsOfService,
          experienceIsEstimated: row.player.yearsOfServiceEstimated,
          birdYears: row.birdYears,
          birdRights: birdRightsOf(row.birdYears),
          status: row.status,
          // A player whose rights are held becomes restricted the moment
          // somebody bids, which is the whole difference on this screen.
          faType: row.status === LeaguePlayerStatus.rightsHeld ? 'RFA' : 'UFA',
          rightsTeam: row.team,
          previousSalary: lastSalary,
          offers: row.faOffers.map((offer) => ({
            id: offer.id,
            team: offer.team,
            years: offer.years,
            firstYearSalary: offer.firstYearSalary,
            raisePct: offer.raisePct,
            contractType: offer.contractType,
            signedVia: offer.signedVia,
            // The offer sheet reopens on an existing bid, so a partial
            // guarantee has to come back the way it was entered.
            guaranteedAmounts: offer.guaranteedAmounts,
            totalValue: offerTotalValue({
              years: offer.years,
              firstYearSalary: offer.firstYearSalary,
              raisePct: offer.raisePct,
              contractType: offer.contractType,
              signedVia: offer.signedVia,
            }),
            expiresAt: offer.expiresAt,
            createdAt: offer.createdAt,
            isMine: teamId ? offer.teamId === teamId : false,
          })),
        };
      }),
    };
  }

  /** What one team has to spend, for the offer sheet to budget against. */
  private async teamState(
    leagueId: number,
    teamId: number,
    league: Awaited<ReturnType<FreeAgencyService['leagueState']>>,
  ) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true, abbr: true, color: true, logo: true },
    });
    if (!team) return null;

    const context = await this.contextFor(leagueId, teamId, league);
    return {
      ...team,
      salaryCap: context.salaryCap,
      minPlayerSalary: context.minPlayerSalary,
      maxPlayerSalary: context.maxPlayerSalary,
      committed: context.committed,
      capSpace:
        context.salaryCap > 0 ? context.salaryCap - context.committed : null,
      rosterCount: context.rosterCount,
      maxRosterSize: context.maxRosterSize,
      twoWayCount: context.twoWayCount,
      maxTwoWay: context.maxTwoWay,
      hardCapEnabled: context.hardCapEnabled,
      hardCapThreshold: context.hardCapThreshold,
    };
  }

  private async findOffer(leagueId: number, offerId: number) {
    const offer = await this.prisma.freeAgencyOffer.findFirst({
      where: { id: offerId, leagueId },
      select: OFFER_SELECT,
    });
    if (!offer) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Offer not found');
    }
    return offer;
  }

  /** The league's season, cap settings and whether free agency is open today. */
  private async leagueState(leagueId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: {
        season: true,
        settings: {
          select: {
            salaryCap: true,
            minPlayerSalary: true,
            hardCapEnabled: true,
            hardCapThreshold: true,
            maxRosterSize: true,
            maxTwoWay: true,
            freeAgencyStyle: true,
          },
        },
      },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const seasonStartYear =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();

    const windows = await this.prisma.leagueCalendarEvent.findMany({
      where: {
        leagueId,
        season: league.season,
        phase: CalendarPhase.freeAgency,
      },
      select: { title: true, startDate: true, endDate: true },
      orderBy: { startDate: 'asc' },
    });

    const now = new Date();
    const open = windows.find(
      (event) =>
        event.startDate <= now && (event.endDate ?? event.startDate) >= now,
    );

    return {
      season: league.season,
      seasonStartYear,
      settings: league.settings,
      freeAgencyStyle: league.settings?.freeAgencyStyle ?? null,
      windowOpen: Boolean(open),
      window: open ?? windows[0] ?? null,
    };
  }

  private async contextFor(
    leagueId: number,
    teamId: number,
    league: Awaited<ReturnType<FreeAgencyService['leagueState']>>,
  ) {
    const salaryCap = league.settings?.salaryCap ?? 0;

    const [years, dead, holds, roster] = await Promise.all([
      this.prisma.contractYear.findMany({
        where: {
          seasonStartYear: league.seasonStartYear,
          contract: { leagueId, teamId, isActive: true },
        },
        select: { capHit: true },
      }),
      this.prisma.deadMoney.aggregate({
        where: { leagueId, teamId, seasonStartYear: league.seasonStartYear },
        _sum: { amount: true },
      }),
      this.prisma.capHold.aggregate({
        where: { leagueId, teamId, seasonStartYear: league.seasonStartYear },
        _sum: { amount: true },
      }),
      this.prisma.leaguePlayer.findMany({
        where: { leagueId, teamId, status: LeaguePlayerStatus.rostered },
        select: { slotType: true },
      }),
    ]);

    const committed =
      years.reduce((total, year) => total + year.capHit, 0) +
      (dead._sum.amount ?? 0) +
      (holds._sum.amount ?? 0);

    const effective = await this.capService.forLeague(
      leagueId,
      league.seasonStartYear,
    );

    const hardCapThreshold = league.settings?.hardCapEnabled
      ? this.thresholdFor(effective, league.settings.hardCapThreshold)
      : null;

    return {
      salaryCap,
      minPlayerSalary: league.settings?.minPlayerSalary ?? 0,
      // Rule 10.2 — the maximum depends on years of service. Until a
      // signing knows whose it is, the screen budgets against the highest of
      // the three; the offer check uses the player's own.
      maxPlayerSalary: effective.maxSalary10Plus,
      maxSalary0to6: effective.maxSalary0to6,
      maxSalary7to9: effective.maxSalary7to9,
      maxSalary10Plus: effective.maxSalary10Plus,
      hardCapEnabled: league.settings?.hardCapEnabled ?? false,
      hardCapThreshold,
      committed,
      rosterCount: roster.filter(
        (row) => row.slotType === RosterSlotType.standard,
      ).length,
      maxRosterSize: league.settings?.maxRosterSize ?? 15,
      twoWayCount: roster.filter(
        (row) => row.slotType === RosterSlotType.twoWay,
      ).length,
      maxTwoWay: league.settings?.maxTwoWay ?? 0,
      windowOpen: league.windowOpen,
    };
  }

  /**
   * Which threshold a league's hard cap setting points at.
   *
   * Reads the entered figures rather than a multiplier: Article 2 says the
   * aprons are entered each league year, not derived.
   */
  private thresholdFor(
    cap: Awaited<ReturnType<CapService['forLeague']>>,
    threshold: string | null | undefined,
  ) {
    if (!threshold || threshold === 'none' || !cap.isSet) return null;
    if (threshold === 'luxuryTax') return cap.luxuryTax;
    if (threshold === 'firstApron') return cap.firstApron;
    if (threshold === 'secondApron') return cap.secondApron;
    return null;
  }

  private toOffer(row: OfferRow) {
    const terms: OfferTerms = {
      years: row.years,
      firstYearSalary: row.firstYearSalary,
      raisePct: row.raisePct,
      contractType: row.contractType,
      signedVia: row.signedVia,
    };
    const checks = (row.checks as unknown as OfferCheck[]) ?? [];

    return {
      id: row.id,
      status: row.status,
      years: row.years,
      firstYearSalary: row.firstYearSalary,
      raisePct: row.raisePct,
      contractType: row.contractType,
      signedVia: row.signedVia,
      totalValue: offerTotalValue(terms),
      // The per-season figures the offer works out to, so the screen never has
      // to repeat the raise arithmetic and get a different answer.
      schedule: offerSeasons(terms, 0).map((season, index) => ({
        yearIndex: index,
        salary: season.salary,
      })),
      // Empty unless the offer is partially guaranteed, so the modal can show
      // back exactly what was named rather than guessing at it.
      guaranteedAmounts: row.guaranteedAmounts,
      checks,
      isLegal: offerIsLegal(checks),
      expiresAt: row.expiresAt,
      respondedAt: row.respondedAt,
      createdAt: row.createdAt,
      team: row.team,
      offeredBy: row.offeredBy,
      player: {
        leaguePlayerId: row.leaguePlayer.id,
        id: row.leaguePlayer.player.id,
        name: row.leaguePlayer.player.name,
        position: row.leaguePlayer.player.position,
        birdYears: row.leaguePlayer.birdYears,
        status: row.leaguePlayer.status,
        currentTeam: row.leaguePlayer.team,
      },
    };
  }
}
