import { CalendarPhase } from '@prisma/client';

// A league's starting calendar. Dates are stored as month and day with the
// year worked out from the season, because the same template is reused every
// season. yearOffset 0 is the season's first year, 1 is the next one, so a
// season written "2026-27" runs from April 2026 to April 2027.
type TCalendarTemplateEntry = {
  title: string;
  phase: CalendarPhase;
  description: string;
  month: number;
  day: number;
  yearOffset: 0 | 1;
  endMonth?: number;
  endDay?: number;
  isApproximate?: boolean;
  displayLabel?: string;
};

export const DEFAULT_CALENDAR_TEMPLATE: TCalendarTemplateEntry[] = [
  {
    title: 'Start of New League Year',
    phase: CalendarPhase.leagueYear,
    description: 'Beginning of the new league year.',
    month: 4,
    day: 19,
    yearOffset: 0,
  },
  {
    title: 'Contract Years Roll Over',
    phase: CalendarPhase.leagueYear,
    description: 'All active contracts advance to their next contract year.',
    month: 4,
    day: 19,
    yearOffset: 0,
  },
  {
    title: 'Negotiations With Own Free Agents Begin',
    phase: CalendarPhase.freeAgency,
    description:
      'Teams may begin negotiating with their own upcoming free agents.',
    month: 4,
    day: 26,
    yearOffset: 0,
  },
  {
    title: 'Player & Team Option Deadline',
    phase: CalendarPhase.contracts,
    description:
      'Deadline for players and teams to exercise or decline options.',
    month: 5,
    day: 10,
    yearOffset: 0,
  },
  {
    title: 'NBA Draft',
    phase: CalendarPhase.nba,
    description: 'The real-world NBA Draft.',
    month: 6,
    day: 25,
    yearOffset: 0,
    isApproximate: true,
    displayLabel: 'Late June',
  },
  {
    title: 'Fantasy Rookie Draft Begins',
    phase: CalendarPhase.draft,
    description: "The league's fantasy rookie draft begins.",
    month: 7,
    day: 5,
    yearOffset: 0,
  },
  {
    title: 'Rookie Contract Signing Period Begins',
    phase: CalendarPhase.draft,
    description: 'Teams may begin signing drafted rookies to their contracts.',
    month: 7,
    day: 12,
    yearOffset: 0,
  },
  {
    title: 'Qualifying Offer Deadline',
    phase: CalendarPhase.contracts,
    description:
      'Deadline to submit qualifying offers to eligible restricted free agents.',
    month: 7,
    day: 16,
    yearOffset: 0,
  },
  {
    title: 'Fantasy Free Agency Begins',
    phase: CalendarPhase.freeAgency,
    description: 'Teams may officially sign free agents.',
    month: 7,
    day: 19,
    yearOffset: 0,
  },
  {
    title: 'Final Roster / Cap Compliance Deadline',
    phase: CalendarPhase.roster,
    description: 'All teams must be in full roster and salary cap compliance.',
    month: 10,
    day: 6,
    yearOffset: 0,
  },
  {
    title: 'Veteran Contract Extension Deadline',
    phase: CalendarPhase.contracts,
    description: 'Last day to sign eligible veteran contract extensions.',
    month: 10,
    day: 19,
    yearOffset: 0,
  },
  {
    title: 'Rookie Scale Extension Deadline',
    phase: CalendarPhase.contracts,
    description: 'Last day to sign eligible rookie scale extensions.',
    month: 10,
    day: 19,
    yearOffset: 0,
  },
  {
    title: 'Start of Regular Season',
    phase: CalendarPhase.season,
    description: 'Beginning of the regular season.',
    month: 10,
    day: 20,
    yearOffset: 0,
  },
  {
    title: 'Trade Eligibility Date',
    phase: CalendarPhase.trades,
    description: 'Most offseason contracts become eligible for trade.',
    month: 12,
    day: 15,
    yearOffset: 0,
  },
  {
    title: 'Contract Guarantee Deadline',
    phase: CalendarPhase.contracts,
    description:
      'Deadline to decide which contracts will be guaranteed for the following season.',
    month: 1,
    day: 10,
    yearOffset: 1,
  },
  {
    title: 'Fantasy Trade Deadline',
    phase: CalendarPhase.trades,
    description: 'Last day to complete trades for the season.',
    month: 2,
    day: 28,
    yearOffset: 1,
  },
  {
    title: 'Fantasy Playoffs Begin',
    phase: CalendarPhase.playoffs,
    description: "The league's fantasy playoffs begin.",
    month: 3,
    day: 15,
    yearOffset: 1,
  },
  {
    title: 'End of Fantasy Playoffs / Season',
    phase: CalendarPhase.playoffs,
    description: 'Final day of the fantasy playoffs and season.',
    month: 4,
    day: 4,
    yearOffset: 1,
  },
  {
    title: 'Postseason / League Freeze',
    phase: CalendarPhase.offseason,
    description: 'League activity is frozen between seasons.',
    month: 4,
    day: 5,
    yearOffset: 1,
    endMonth: 4,
    endDay: 18,
  },
];

// "2026-27" -> 2026. Anything unexpected falls back to the current year so a
// league is never left without a calendar.
export const seasonStartYear = (season: string) => {
  const year = Number(season.slice(0, 4));
  return Number.isInteger(year) && year > 1900
    ? year
    : new Date().getFullYear();
};

// "2026-27" -> "2027-28"
export const nextSeason = (season: string) => {
  const start = seasonStartYear(season) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

// Dates are built in UTC so a deadline does not shift by a day depending on
// where the server runs.
const utcDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

export const buildDefaultCalendar = (season: string) => {
  const startYear = seasonStartYear(season);

  return DEFAULT_CALENDAR_TEMPLATE.map((entry) => {
    const year = startYear + entry.yearOffset;

    return {
      season,
      title: entry.title,
      phase: entry.phase,
      description: entry.description,
      startDate: utcDate(year, entry.month, entry.day),
      endDate:
        entry.endMonth && entry.endDay
          ? utcDate(year, entry.endMonth, entry.endDay)
          : null,
      isApproximate: entry.isApproximate ?? false,
      displayLabel: entry.displayLabel ? `${entry.displayLabel} ${year}` : null,
      isDefault: true,
    };
  });
};
