import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePlayerName } from './player.normalize';
import {
  NameMatchMethod,
  NameMatchStatus,
  NameMatch,
  PlayerCandidate,
} from './player.types';

/**
 * A trigram score at or above this is treated as the same player without
 * asking. Set deliberately high: a wrong auto-match is silent, while a row
 * sent for review costs the commissioner one click.
 */
const AUTO_ACCEPT = 0.9;

/** How many near misses the preview offers when it cannot decide. */
const CANDIDATE_LIMIT = 3;

const PLAYER_SELECT = {
  id: true,
  name: true,
  position: true,
  draftYear: true,
  nbaTeam: { select: { abbreviation: true } },
} satisfies Prisma.PlayerSelect;

type PlayerRow = Prisma.PlayerGetPayload<{ select: typeof PLAYER_SELECT }>;

type FuzzyRow = {
  id: number;
  name: string;
  position: string | null;
  draftYear: number | null;
  nbaTeam: string | null;
  confidence: number;
};

@Injectable()
export class PlayerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a page of imported names to real players.
   *
   * Written to answer a whole file rather than a row: an import carries a few
   * hundred names, and a per-row round trip would be a few hundred round
   * trips. Exact names and aliases are each settled in one query for the whole
   * batch, and only the leftovers — usually a handful — need a trigram search
   * of their own, because ordering by similarity cannot be batched.
   */
  async matchNames(inputs: string[]): Promise<NameMatch[]> {
    const normalizedByInput = new Map<string, string>();
    for (const input of inputs) {
      normalizedByInput.set(input, normalizePlayerName(input));
    }

    const normalized = [...new Set(normalizedByInput.values())].filter(Boolean);
    if (normalized.length === 0) {
      return inputs.map((input) => this.notFound(input, ''));
    }

    const [exactRows, aliasRows] = await Promise.all([
      this.prisma.player.findMany({
        where: { nameNormalized: { in: normalized } },
        select: { ...PLAYER_SELECT, nameNormalized: true },
      }),
      this.prisma.playerAlias.findMany({
        where: { aliasNormalized: { in: normalized } },
        select: { aliasNormalized: true, player: { select: PLAYER_SELECT } },
      }),
    ]);

    // Grouped rather than keyed, because two different players can normalise
    // to the same string. That collision is the whole reason step 4 of the
    // client's rules exists, so it must survive into the result.
    const exactByName = new Map<string, PlayerRow[]>();
    for (const row of exactRows) {
      const bucket = exactByName.get(row.nameNormalized) ?? [];
      bucket.push(row);
      exactByName.set(row.nameNormalized, bucket);
    }

    const aliasByName = new Map<string, PlayerRow>();
    for (const row of aliasRows) {
      aliasByName.set(row.aliasNormalized, row.player);
    }

    const unresolved = normalized.filter(
      (name) => !exactByName.has(name) && !aliasByName.has(name),
    );

    const fuzzyByName = new Map<string, FuzzyRow[]>();
    for (const name of unresolved) {
      fuzzyByName.set(name, await this.fuzzyCandidates(name));
    }

    return inputs.map((input) => {
      const name = normalizedByInput.get(input) ?? '';
      if (!name) return this.notFound(input, name);

      const exact = exactByName.get(name);
      if (exact?.length === 1) {
        return this.matched(input, name, exact[0].id, NameMatchMethod.exact, 1);
      }
      if (exact && exact.length > 1) {
        // Never auto-matched, however confident the string looks.
        return {
          input,
          normalized: name,
          status: NameMatchStatus.needsReview,
          method: null,
          confidence: null,
          playerId: null,
          candidates: exact.map((row) => this.toCandidate(row, 1)),
        };
      }

      const alias = aliasByName.get(name);
      if (alias) {
        return this.matched(input, name, alias.id, NameMatchMethod.alias, 1);
      }

      const candidates = fuzzyByName.get(name) ?? [];
      if (candidates.length === 0) return this.notFound(input, name);

      const [best, second] = candidates;
      // A clear winner only counts as clear when nothing else is close to it.
      const isClear =
        best.confidence >= AUTO_ACCEPT &&
        (!second || second.confidence < AUTO_ACCEPT);

      if (isClear) {
        return this.matched(
          input,
          name,
          best.id,
          NameMatchMethod.fuzzy,
          best.confidence,
        );
      }

      return {
        input,
        normalized: name,
        status: NameMatchStatus.needsReview,
        method: null,
        confidence: null,
        playerId: null,
        candidates: candidates.map((row) => ({
          id: row.id,
          name: row.name,
          position: row.position,
          draftYear: row.draftYear,
          nbaTeam: row.nbaTeam,
          confidence: row.confidence,
        })),
      };
    });
  }

  /**
   * Records what a commissioner decided about a name the matcher could not
   * place, so the next import places it without asking.
   *
   * The alias is global, like the player it points at. That is what makes it
   * worth storing, and also why the account that created it is kept.
   */
  async rememberAlias(playerId: number, input: string, createdById?: number) {
    const aliasNormalized = normalizePlayerName(input);
    if (!aliasNormalized) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'That name is empty.');
    }

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true, name: true, nameNormalized: true },
    });
    if (!player) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Player not found');
    }

    // The player's own name already matches on its own; storing it as an alias
    // would be a row that can never be read.
    if (player.nameNormalized === aliasNormalized) return player;

    const existing = await this.prisma.playerAlias.findUnique({
      where: { aliasNormalized },
      select: { playerId: true, player: { select: { name: true } } },
    });

    if (existing && existing.playerId !== playerId) {
      throw new AppError(
        HttpStatus.CONFLICT,
        `"${input}" already points at ${existing.player.name}. Remove that alias before pointing it somewhere else.`,
      );
    }

    if (!existing) {
      await this.prisma.playerAlias.create({
        data: { playerId, alias: input, aliasNormalized, createdById },
      });
    }

    return player;
  }

  /**
   * The preview's own search box, for when the commissioner knows who the row
   * meant and the matcher did not. Exact and prefix hits come first; a
   * trigram pass catches the rest.
   */
  async search(query: string, limit = 10) {
    const normalized = normalizePlayerName(query);
    if (!normalized) return [];

    const rows = await this.prisma.$queryRaw<FuzzyRow[]>`
      SELECT p."id",
             p."name",
             p."position",
             p."draftYear",
             t."abbreviation" AS "nbaTeam",
             GREATEST(
               similarity(p."nameNormalized", ${normalized}),
               CASE WHEN p."nameNormalized" LIKE ${normalized + '%'} THEN 0.95 ELSE 0 END
             ) AS "confidence"
      FROM "Player" p
      LEFT JOIN "NbaTeam" t ON t."id" = p."nbaTeamId"
      WHERE p."nameNormalized" % ${normalized}
         OR p."nameNormalized" LIKE ${'%' + normalized + '%'}
      ORDER BY "confidence" DESC, p."name" ASC
      LIMIT ${limit}
    `;

    return rows;
  }

  async findOne(playerId: number) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: {
        nbaTeam: true,
        aliases: { select: { id: true, alias: true } },
      },
    });
    if (!player) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Player not found');
    }
    return player;
  }

  private async fuzzyCandidates(normalized: string) {
    return this.prisma.$queryRaw<FuzzyRow[]>`
      SELECT p."id",
             p."name",
             p."position",
             p."draftYear",
             t."abbreviation" AS "nbaTeam",
             similarity(p."nameNormalized", ${normalized}) AS "confidence"
      FROM "Player" p
      LEFT JOIN "NbaTeam" t ON t."id" = p."nbaTeamId"
      WHERE p."nameNormalized" % ${normalized}
      ORDER BY "confidence" DESC, p."name" ASC
      LIMIT ${CANDIDATE_LIMIT}
    `;
  }

  private toCandidate(row: PlayerRow, confidence: number): PlayerCandidate {
    return {
      id: row.id,
      name: row.name,
      position: row.position,
      draftYear: row.draftYear,
      nbaTeam: row.nbaTeam?.abbreviation ?? null,
      confidence,
    };
  }

  private matched(
    input: string,
    normalized: string,
    playerId: number,
    method: NameMatch['method'],
    confidence: number,
  ): NameMatch {
    return {
      input,
      normalized,
      status: NameMatchStatus.matched,
      method,
      confidence,
      playerId,
      candidates: [],
    };
  }

  private notFound(input: string, normalized: string): NameMatch {
    return {
      input,
      normalized,
      status: NameMatchStatus.notFound,
      method: null,
      confidence: null,
      playerId: null,
      candidates: [],
    };
  }
}
