import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/appError';

const BASE_URL = 'https://api.balldontlie.io';

/** The largest page the API allows. Fewer, bigger pages means fewer requests. */
const PER_PAGE = 100;

/**
 * GOAT allows 600 requests a minute. 150ms between pages is 400 an hour, far
 * below it, and leaves room for the other jobs to run at the same time.
 */
const PAGE_DELAY_MS = 150;

/** A page of results, as balldontlie returns them. */
type Page<T> = {
  data: T[];
  meta?: { next_cursor?: number | null; per_page?: number };
};

export type BdlTeam = {
  id: number;
  abbreviation: string;
  city: string;
  conference: string | null;
  division: string | null;
  full_name: string;
  name: string;
};

export type BdlPlayer = {
  id: number;
  first_name: string;
  last_name: string;
  position: string | null;
  height: string | null;
  weight: string | null;
  jersey_number: string | null;
  college: string | null;
  country: string | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team: BdlTeam | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class BalldontlieClient {
  private readonly logger = new Logger(BalldontlieClient.name);

  constructor(private readonly config: ConfigService) {}

  /** False when no key is configured, so callers can say so before starting. */
  get isConfigured(): boolean {
    return Boolean(this.config.get<string>('BALLDONTLIE_API_KEY'));
  }

  private get apiKey(): string {
    const key = this.config.get<string>('BALLDONTLIE_API_KEY');
    if (!key) {
      throw new AppError(
        HttpStatus.FAILED_DEPENDENCY,
        'BALLDONTLIE_API_KEY is not set. Add it to the environment before running a sync.',
      );
    }
    return key;
  }

  /**
   * One request. The key goes in a bare `Authorization` header — balldontlie
   * does not use the `Bearer` prefix.
   */
  private async get<T>(path: string, params: Record<string, string>) {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      headers: { Authorization: this.apiKey },
    });

    if (response.status === 401) {
      throw new AppError(
        HttpStatus.FAILED_DEPENDENCY,
        'balldontlie rejected the API key.',
      );
    }
    if (response.status === 429) {
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'balldontlie rate limit reached. Try again shortly.',
      );
    }
    if (!response.ok) {
      throw new AppError(
        HttpStatus.BAD_GATEWAY,
        `balldontlie answered ${response.status} for ${path}.`,
      );
    }

    return (await response.json()) as Page<T>;
  }

  /**
   * Walks every page of an endpoint, yielding one page at a time.
   *
   * A generator rather than a list: the player endpoint runs to thousands of
   * rows, and holding them all in memory to write them once would make a
   * failure halfway through lose everything before it.
   */
  async *paginate<T>(
    path: string,
    params: Record<string, string> = {},
    startCursor?: string,
  ): AsyncGenerator<{ rows: T[]; cursor: string | null }> {
    let cursor: string | null = startCursor ?? null;
    let pages = 0;

    for (;;) {
      const page: Page<T> = await this.get<T>(path, {
        ...params,
        per_page: String(PER_PAGE),
        ...(cursor ? { cursor } : {}),
      });

      const next = page.meta?.next_cursor;
      cursor = next === null || next === undefined ? null : String(next);
      pages += 1;

      yield { rows: page.data ?? [], cursor };

      if (!cursor) break;
      await sleep(PAGE_DELAY_MS);
    }

    this.logger.log(`${path}: ${pages} page(s)`);
  }

  teams() {
    return this.paginate<BdlTeam>('/v1/teams');
  }

  /**
   * Active players only. The full roll includes everyone who ever played,
   * which is tens of thousands of rows a fantasy league has no use for.
   */
  activePlayers(startCursor?: string) {
    return this.paginate<BdlPlayer>('/v1/players/active', {}, startCursor);
  }
}
