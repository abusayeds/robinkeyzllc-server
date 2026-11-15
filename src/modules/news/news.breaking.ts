import { NewsItemType } from '@prisma/client';

/**
 * The Breaking News format, as pure functions.
 *
 * Every transaction the league makes is posted the same way: one label, a
 * headline that names the teams and the biggest player, what each team
 * received, and the cap impact. Nothing here reads the database, so the shape
 * of a post can be read in one place and tested without one.
 */

/** One player moving, with the terms a post shows beside his name. */
export type NewsPlayer = {
  name: string;
  position: string | null;
  salary: number | null;
  /** The last season of his deal, e.g. 2028. */
  throughSeasonStartYear: number | null;
};

/** One pick moving. Year, round and the team it was born to. */
export type NewsPick = {
  label: string;
  originalTeamAbbr: string | null;
};

export type NewsTeamLeg = {
  teamId: number;
  name: string;
  abbr: string;
  logo: string | null;
  /** What this team received. A team can receive nothing in a three-way. */
  players: NewsPlayer[];
  picks: NewsPick[];
  /** Null when the figures were not available when the post was written. */
  capBefore: number | null;
  capAfter: number | null;
  capSpaceAfter: number | null;
};

export type NewsPayload = {
  teams: NewsTeamLeg[];
  /** Free text under the headline, for the types that need one. */
  summary: string | null;
  /** "Accepted by both teams · Processed Nov 12" and the like. */
  status: string | null;
};

const money = (value: number) => {
  const millions = value / 1_000_000;
  // Posts are read at a glance, so the headline figures are abbreviated even
  // though the trade centre shows whole dollars.
  return `$${millions >= 100 ? Math.round(millions) : millions.toFixed(1)}M`;
};

export const newsMoney = money;

/**
 * Verbs for a trade headline.
 *
 * Rotated by the item's own source id rather than at random, so the same post
 * reads the same way every time it is loaded, and a feed of five trades does
 * not say "acquire" five times.
 */
const TRADE_VERBS = ['acquire', 'land', 'add', 'swing a deal for'] as const;

export const tradeVerb = (seed: number) =>
  TRADE_VERBS[Math.abs(seed) % TRADE_VERBS.length];

/** The name a headline leads with: the largest salary that moved. */
export function biggestName(teams: NewsTeamLeg[]): NewsPlayer | null {
  const players = teams.flatMap((team) => team.players);
  if (players.length === 0) return null;
  return players.reduce((most, player) =>
    (player.salary ?? 0) > (most.salary ?? 0) ? player : most,
  );
}

/** Which team received a given player. */
function receiverOf(
  teams: NewsTeamLeg[],
  player: NewsPlayer,
): NewsTeamLeg | null {
  return teams.find((team) => team.players.includes(player)) ?? null;
}

/**
 * The headline, built from the data.
 *
 * A commissioner can replace it, but there is always one to start from: a
 * post with no headline would be the test title all over again.
 */
export function autoHeadline(
  type: NewsItemType,
  payload: NewsPayload,
  seed: number,
): string {
  const teams = payload.teams;
  const shortOf = (team: NewsTeamLeg) => {
    const words = team.name.trim().split(/\s+/);
    return words.length > 1 ? words[words.length - 1] : team.name.trim();
  };

  switch (type) {
    case NewsItemType.trade: {
      const star = biggestName(teams);
      if (!star) {
        // A picks-only deal still has two teams to name.
        return teams.length > 0
          ? `${teams.map(shortOf).join(' and ')} swap draft picks`
          : 'Trade completed';
      }
      const to = receiverOf(teams, star);
      const from = teams.find((team) => team.teamId !== to?.teamId);
      const others = teams.length > 2 ? ` in ${teams.length}-team deal` : '';
      return to && from
        ? `${shortOf(to)} ${tradeVerb(seed)} ${star.name} from ${shortOf(from)}${others}`
        : `${star.name} traded${others}`;
    }

    case NewsItemType.signing: {
      const team = teams[0];
      const player = team?.players[0];
      if (!team || !player) return 'Free agent signs';
      const years = player.throughSeasonStartYear;
      const terms =
        player.salary !== null
          ? years
            ? ` (thru ${years}, ${money(player.salary)})`
            : ` (${money(player.salary)})`
          : '';
      return `${shortOf(team)} sign ${player.name}${terms}`;
    }

    case NewsItemType.extension: {
      const team = teams[0];
      const player = team?.players[0];
      if (!team || !player) return 'Contract extended';
      return player.throughSeasonStartYear
        ? `${shortOf(team)} extend ${player.name} through ${player.throughSeasonStartYear}`
        : `${shortOf(team)} extend ${player.name}`;
    }

    case NewsItemType.waiver: {
      const team = teams[0];
      const player = team?.players[0];
      return team && player
        ? `${shortOf(team)} waive ${player.name}`
        : 'Player waived';
    }

    case NewsItemType.claim: {
      const team = teams[0];
      const player = team?.players[0];
      return team && player
        ? `${shortOf(team)} claim ${player.name} off waivers`
        : 'Waiver claim';
    }

    case NewsItemType.offerSheet: {
      const team = teams[0];
      const player = team?.players[0];
      return team && player
        ? `${shortOf(team)} match offer sheet for ${player.name}`
        : 'Offer sheet matched';
    }

    case NewsItemType.draftPick: {
      const team = teams[0];
      const player = team?.players[0];
      const pick = payload.summary;
      return team && player
        ? `${shortOf(team)} select ${player.name}${pick ? ` at ${pick}` : ''}`
        : 'Draft selection';
    }

    case NewsItemType.veto: {
      const named = teams.map(shortOf).join('–');
      return named
        ? `Commissioner vetoes ${named} trade`
        : 'Commissioner vetoes trade';
    }

    default:
      return 'League news';
  }
}

/** The one-line summary the feed list shows under a headline. */
export function excerptOf(type: NewsItemType, payload: NewsPayload): string {
  if (payload.summary) return payload.summary;

  const parts = payload.teams
    .filter((team) => team.players.length > 0 || team.picks.length > 0)
    .map((team) => {
      const pieces = [
        ...team.players.map((player) => player.name),
        ...team.picks.map((pick) => pick.label),
      ];
      return `${team.abbr} receive ${pieces.join(', ')}`;
    });

  return parts.length > 0
    ? parts.join(' · ')
    : type === NewsItemType.veto
      ? 'The commissioner reversed this trade.'
      : '';
}
