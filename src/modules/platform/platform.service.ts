import { Injectable } from '@nestjs/common';
import { LeagueRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** How many months the two charts cover. */
const GROWTH_MONTHS = 12;
const SIGNUP_MONTHS = 6;

/** How many rows the two "recent" lists show. */
const RECENT_LIMIT = 5;

const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const monthLabel = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

/** The last `count` months, oldest first, as keys and labels. */
function lastMonths(count: number) {
  const months: { key: string; label: string; start: Date }[] = [];
  const now = new Date();

  for (let back = count - 1; back >= 0; back -= 1) {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1),
    );
    months.push({ key: monthKey(start), label: monthLabel(start), start });
  }

  return months;
}

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The Super Admin landing page, in one request.
   *
   * Counted in the database rather than by downloading the two lists and
   * measuring them: the lists are paginated, so a page of twenty would have
   * given a total of twenty.
   */
  async overview() {
    const growthMonths = lastMonths(GROWTH_MONTHS);
    const since = growthMonths[0].start;

    const [
      totalLeagues,
      activeLeagues,
      archivedLeagues,
      totalUsers,
      deletedUsers,
      verifiedUsers,
      commissionerRows,
      leagueDates,
      userDates,
      recentLeagues,
      recentUsers,
    ] = await Promise.all([
      this.prisma.league.count(),
      // A league is being set up until players have been brought in, which is
      // exactly what setupLocked marks.
      this.prisma.league.count({
        where: { isDeleted: false, settings: { setupLocked: true } },
      }),
      this.prisma.league.count({ where: { isDeleted: true } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isDeleted: true } }),
      this.prisma.user.count({ where: { isEmailVerified: true } }),
      // Distinct users, not memberships: one person commissioning three
      // leagues is one commissioner.
      this.prisma.leagueMember.findMany({
        where: { role: LeagueRole.commissioner },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.league.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.league.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          name: true,
          teamCount: true,
          isDeleted: true,
          createdAt: true,
          createdBy: { select: { name: true } },
          settings: { select: { setupLocked: true } },
          _count: { select: { teams: true } },
        },
      }),
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          name: true,
          image: true,
          createdAt: true,
          leagueMemberships: { select: { role: true } },
          teamMemberships: { select: { id: true }, take: 1 },
        },
      }),
    ]);

    const countByMonth = (rows: { createdAt: Date }[]) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const key = monthKey(row.createdAt);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    };

    const leaguesByMonth = countByMonth(leagueDates);
    const usersByMonth = countByMonth(userDates);

    // The growth chart is cumulative, so it starts from everything created
    // before the window and adds each month on top. A line that drops because
    // one quiet month followed a busy one is not growth.
    const before = totalLeagues - leagueDates.length;
    let running = before;
    const growth = growthMonths.map((month) => {
      running += leaguesByMonth.get(month.key) ?? 0;
      return { label: month.label, value: running };
    });

    const signupMonths = growthMonths.slice(-SIGNUP_MONTHS);
    const signups = signupMonths.map((month) => ({
      label: month.label,
      value: usersByMonth.get(month.key) ?? 0,
    }));

    const thisMonth = monthKey(new Date());
    const newThisMonth =
      (leaguesByMonth.get(thisMonth) ?? 0) + (usersByMonth.get(thisMonth) ?? 0);

    return {
      stats: {
        totalLeagues,
        activeLeagues,
        archivedLeagues,
        totalUsers,
        activeUsers: totalUsers - deletedUsers,
        verifiedUsers,
        commissioners: commissionerRows.length,
        newThisMonth,
      },
      growth,
      signups,
      recentLeagues: recentLeagues.map((league) => ({
        id: league.id,
        name: league.name,
        owner: league.createdBy.name,
        teams: league._count.teams,
        teamCount: league.teamCount,
        status: league.isDeleted
          ? 'Archived'
          : league.settings?.setupLocked
            ? 'Active'
            : 'Draft',
        createdAt: league.createdAt,
      })),
      recentUsers: recentUsers.map((user) => ({
        id: user.id,
        name: user.name,
        image: user.image,
        createdAt: user.createdAt,
        role: user.leagueMemberships.some(
          (m) => m.role === LeagueRole.commissioner,
        )
          ? 'Commissioner'
          : user.teamMemberships.length > 0
            ? 'Owner'
            : 'Member',
      })),
    };
  }
}
