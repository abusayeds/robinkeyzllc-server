import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { PlayerStatsService } from '../nba/player-stats.service';

/**
 * Everything one player card shows, in one read.
 *
 * League-scoped although the player is global, because half of the card is the
 * league's own: his contract, his bird years, the team that holds him. The
 * other half — bio, season averages, career table, game log — is the same for
 * every league and comes off the shared tables.
 *
 * Replaces the card's own invented data. It used to build a game log and a
 * career history from a hash of the player id, which meant three screens drew
 * five fictional games and five fictional seasons for every player.
 */

/** Only ever shown, so it is worked out here rather than stored anywhere. */
function ageFrom(birthdate: Date | null): number | null {
  if (!birthdate) return null;

  const today = new Date();
  let age = today.getUTCFullYear() - birthdate.getUTCFullYear();

  const monthDiff = today.getUTCMonth() - birthdate.getUTCMonth();
  const beforeBirthday =
    monthDiff < 0 ||
    (monthDiff === 0 && today.getUTCDate() < birthdate.getUTCDate());
  if (beforeBirthday) age -= 1;

  return age;
}

/**
 * "2021 Rd 1 Pk 14", or null when nothing is known.
 *
 * balldontlie leaves all three blank for an undrafted player, and leaves the
 * round and the pick blank for some international ones, so each part is only
 * added when it is there. A player with a draft year and nothing else reads
 * "2021" rather than "2021 Rd null".
 */
function draftInfo(player: {
  draftYear: number | null;
  draftRound: number | null;
  draftNumber: number | null;
}): string | null {
  if (player.draftYear === null) return null;

  const parts = [String(player.draftYear)];
  if (player.draftRound !== null) parts.push(`Rd ${player.draftRound}`);
  if (player.draftNumber !== null) parts.push(`Pk ${player.draftNumber}`);

  return parts.join(' ');
}

@Injectable()
export class PlayerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: PlayerStatsService,
  ) {}

  async profile(leagueId: number, playerId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { season: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const seasonStartYear =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        position: true,
        height: true,
        weight: true,
        college: true,
        country: true,
        birthdate: true,
        headshot: true,
        draftYear: true,
        draftRound: true,
        draftNumber: true,
        yearsOfService: true,
        yearsOfServiceEstimated: true,
        isActive: true,
        nbaTeam: { select: { abbreviation: true, fullName: true } },
        injury: {
          select: { status: true, description: true, returnDate: true },
        },
      },
    });
    if (!player) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Player not found');
    }

    // Null for a player this league has never held — a draft board asks about
    // the whole pool, so that is the normal case rather than an error.
    const membership = await this.prisma.leaguePlayer.findUnique({
      where: { leagueId_playerId: { leagueId, playerId } },
      select: {
        id: true,
        status: true,
        slotType: true,
        birdYears: true,
        team: { select: { id: true, name: true, abbr: true, logo: true } },
        contracts: {
          where: { isActive: true },
          select: {
            id: true,
            contractType: true,
            signedVia: true,
            source: true,
            signedSeasonStartYear: true,
            startSeasonStartYear: true,
            endSeasonStartYear: true,
            rfaOnExpiry: true,
            years: {
              select: {
                seasonStartYear: true,
                salary: true,
                capHit: true,
                optionType: true,
                guaranteeType: true,
                guaranteedAmount: true,
              },
              orderBy: { seasonStartYear: 'asc' },
            },
          },
        },
      },
    });

    // The career table is the one read that already knows every season, so the
    // headline averages are taken from it instead of being asked for again.
    const [career, gameLog] = await Promise.all([
      this.stats.career(playerId),
      this.stats.gameLog(playerId),
    ]);

    const contract = membership?.contracts[0] ?? null;

    return {
      seasonStartYear,
      player: {
        id: player.id,
        name: player.name,
        firstName: player.firstName,
        lastName: player.lastName,
        position: player.position,
        nbaTeam: player.nbaTeam?.abbreviation ?? null,
        nbaTeamName: player.nbaTeam?.fullName ?? null,
        height: player.height,
        weight: player.weight,
        college: player.college,
        country: player.country,
        age: ageFrom(player.birthdate),
        experience: player.yearsOfService,
        experienceIsEstimated: player.yearsOfServiceEstimated,
        draftInfo: draftInfo(player),
        headshot: player.headshot,
        isActive: player.isActive,
      },
      injury: player.injury,
      league: membership
        ? {
            leaguePlayerId: membership.id,
            status: membership.status,
            slotType: membership.slotType,
            birdYears: membership.birdYears,
            team: membership.team,
          }
        : null,
      contract: contract
        ? {
            id: contract.id,
            type: contract.contractType,
            signedVia: contract.signedVia,
            source: contract.source,
            signedSeasonStartYear: contract.signedSeasonStartYear,
            startSeasonStartYear: contract.startSeasonStartYear,
            endSeasonStartYear: contract.endSeasonStartYear,
            years:
              contract.endSeasonStartYear - contract.startSeasonStartYear + 1,
            // Counted from this league's season, not from the first year of
            // the deal: what an owner wants to know is how long he is held
            // for from here.
            yearsRemaining: Math.max(
              0,
              contract.endSeasonStartYear - seasonStartYear + 1,
            ),
            rfaOnExpiry: contract.rfaOnExpiry,
            seasons: contract.years,
          }
        : null,
      // The season averages the card leads with. Taken from the career rows
      // rather than read again: `career` already grouped every season, and the
      // league's own season is the one its screens are about.
      seasonAverages:
        career.find((row) => row.season === seasonStartYear) ??
        career[0] ??
        null,
      career,
      gameLog,
    };
  }
}
