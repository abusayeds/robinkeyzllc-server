/**
 * The figures from the AVORA CBA rule book, Version 1, 2026-27 league year.
 *
 * Every number here is copied from the client's own document. Nothing is
 * rounded, inferred or recalculated: the rule book states the first apron at
 * **126.71%** of the cap, not 127%, and the difference is about $480,000 —
 * enough to put a team in the wrong tier.
 *
 * These are seeded once as a starting point. Rule 2.2 says the Super Admin
 * owns them from then on, so the seed never overwrites a row that exists.
 */

/** Rule 2.3 — entered each league year. */
export const CAP_YEAR_2026 = {
  seasonStartYear: 2026,
  salaryCap: 164_961_000,
  luxuryTax: 200_428_000,
  firstApron: 209_015_000,
  secondApron: 221_686_000,
  // The rule book prints "Entered yearly" without a figure for 2026-27. The
  // cap sheet needs one for Rule 10.12, so this is the NBA's published
  // average and is flagged in the notes as the one number here that did not
  // come from the client.
  averagePlayerSalary: 12_800_000,
} as const;

/** Rule 10.11 — minimum salary as a percentage of the cap, by years of service. */
export const MINIMUM_SALARY_SCALE: {
  yearsOfService: number;
  percentOfCap: number;
}[] = [
  { yearsOfService: 0, percentOfCap: 0.8231 },
  { yearsOfService: 1, percentOfCap: 1.3246 },
  { yearsOfService: 2, percentOfCap: 1.4848 },
  { yearsOfService: 3, percentOfCap: 1.5383 },
  { yearsOfService: 4, percentOfCap: 1.5917 },
  { yearsOfService: 5, percentOfCap: 1.7252 },
  { yearsOfService: 6, percentOfCap: 1.8587 },
  { yearsOfService: 7, percentOfCap: 1.9922 },
  { yearsOfService: 8, percentOfCap: 2.1258 },
  { yearsOfService: 9, percentOfCap: 2.1363 },
  // 10 means "10 or more": the scale stops rising here.
  { yearsOfService: 10, percentOfCap: 2.35 },
];

/**
 * Rule 11.9 — the first-round rookie scale.
 *
 * Three stored values per slot: Year 1 as a percentage of the cap, then Year
 * 4 and the qualifying offer as percentages of Year 1. Years 2 and 3 are
 * 105% and 110% of Year 1 for every slot and live on `SecondRoundScale`.
 */
export const ROOKIE_SCALE: {
  pick: number;
  year1PercentOfCap: number;
  year4PercentOfYear1: number;
  qoPercentOfYear1: number;
}[] = [
  {
    pick: 1,
    year1PercentOfCap: 8.9403,
    year4PercentOfYear1: 138.71,
    qoPercentOfYear1: 194.194,
  },
  {
    pick: 2,
    year1PercentOfCap: 7.9991,
    year4PercentOfYear1: 138.82,
    qoPercentOfYear1: 195.042,
  },
  {
    pick: 3,
    year1PercentOfCap: 7.1834,
    year4PercentOfYear1: 139.04,
    qoPercentOfYear1: 196.324,
  },
  {
    pick: 4,
    year1PercentOfCap: 6.4765,
    year4PercentOfYear1: 139.15,
    qoPercentOfYear1: 197.454,
  },
  {
    pick: 5,
    year1PercentOfCap: 5.8649,
    year4PercentOfYear1: 139.37,
    qoPercentOfYear1: 198.742,
  },
  {
    pick: 6,
    year1PercentOfCap: 5.3267,
    year4PercentOfYear1: 139.48,
    qoPercentOfYear1: 200.014,
  },
  {
    pick: 7,
    year1PercentOfCap: 4.8627,
    year4PercentOfYear1: 139.7,
    qoPercentOfYear1: 201.308,
  },
  {
    pick: 8,
    year1PercentOfCap: 4.4548,
    year4PercentOfYear1: 139.92,
    qoPercentOfYear1: 202.604,
  },
  {
    pick: 9,
    year1PercentOfCap: 4.0948,
    year4PercentOfYear1: 140.14,
    qoPercentOfYear1: 203.904,
  },
  {
    pick: 10,
    year1PercentOfCap: 3.8902,
    year4PercentOfYear1: 140.25,
    qoPercentOfYear1: 205.046,
  },
  {
    pick: 11,
    year1PercentOfCap: 3.6956,
    year4PercentOfYear1: 145.97,
    qoPercentOfYear1: 214.43,
  },
  {
    pick: 12,
    year1PercentOfCap: 3.5109,
    year4PercentOfYear1: 151.58,
    qoPercentOfYear1: 223.732,
  },
  {
    pick: 13,
    year1PercentOfCap: 3.3353,
    year4PercentOfYear1: 157.19,
    qoPercentOfYear1: 233.113,
  },
  {
    pick: 14,
    year1PercentOfCap: 3.1687,
    year4PercentOfYear1: 162.91,
    qoPercentOfYear1: 242.899,
  },
  {
    pick: 15,
    year1PercentOfCap: 3.0101,
    year4PercentOfYear1: 168.63,
    qoPercentOfYear1: 252.608,
  },
  {
    pick: 16,
    year1PercentOfCap: 2.8597,
    year4PercentOfYear1: 168.74,
    qoPercentOfYear1: 253.954,
  },
  {
    pick: 17,
    year1PercentOfCap: 2.7166,
    year4PercentOfYear1: 168.96,
    qoPercentOfYear1: 255.468,
  },
  {
    pick: 18,
    year1PercentOfCap: 2.5809,
    year4PercentOfYear1: 169.18,
    qoPercentOfYear1: 256.984,
  },
  {
    pick: 19,
    year1PercentOfCap: 2.4647,
    year4PercentOfYear1: 169.4,
    qoPercentOfYear1: 258.504,
  },
  {
    pick: 20,
    year1PercentOfCap: 2.3659,
    year4PercentOfYear1: 169.62,
    qoPercentOfYear1: 260.027,
  },
  {
    pick: 21,
    year1PercentOfCap: 2.2713,
    year4PercentOfYear1: 175.23,
    qoPercentOfYear1: 270.029,
  },
  {
    pick: 22,
    year1PercentOfCap: 2.1806,
    year4PercentOfYear1: 180.95,
    qoPercentOfYear1: 280.111,
  },
  {
    pick: 23,
    year1PercentOfCap: 2.0934,
    year4PercentOfYear1: 186.67,
    qoPercentOfYear1: 290.272,
  },
  {
    pick: 24,
    year1PercentOfCap: 2.0098,
    year4PercentOfYear1: 192.39,
    qoPercentOfYear1: 300.513,
  },
  {
    pick: 25,
    year1PercentOfCap: 1.9291,
    year4PercentOfYear1: 198.11,
    qoPercentOfYear1: 310.835,
  },
  {
    pick: 26,
    year1PercentOfCap: 1.8652,
    year4PercentOfYear1: 198.33,
    qoPercentOfYear1: 312.568,
  },
  {
    pick: 27,
    year1PercentOfCap: 1.8114,
    year4PercentOfYear1: 198.44,
    qoPercentOfYear1: 314.131,
  },
  {
    pick: 28,
    year1PercentOfCap: 1.8001,
    year4PercentOfYear1: 198.55,
    qoPercentOfYear1: 315.695,
  },
  {
    pick: 29,
    year1PercentOfCap: 1.7873,
    year4PercentOfYear1: 198.55,
    qoPercentOfYear1: 317.68,
  },
  {
    pick: 30,
    year1PercentOfCap: 1.7742,
    year4PercentOfYear1: 198.55,
    qoPercentOfYear1: 317.68,
  },
];
