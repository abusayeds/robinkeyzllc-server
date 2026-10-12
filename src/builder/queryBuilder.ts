/**
 * Builds Prisma findMany args from a query string.
 *
 *   const qb = new QueryBuilder<User>(query).search(['name']).filter().sort().paginate();
 *   const data  = await prisma.user.findMany(qb.build<Prisma.UserFindManyArgs>());
 *   const total = await prisma.user.count({ where: qb.getWhere() });
 *   const pagination = qb.calculatePagination(total);
 */
export class QueryBuilder<T> {
  public query: Record<string, unknown>;

  private whereConditions: Record<string, unknown>[] = [];
  private orderBy: Record<string, 'asc' | 'desc'>[] = [{ createdAt: 'desc' }];
  private selectFields?: Record<string, boolean>;
  private page = 1;
  private limit = 10;

  private static readonly EXCLUDED = [
    'searchTerm',
    'sort',
    'limit',
    'page',
    'fields',
  ];

  constructor(query: Record<string, unknown> = {}) {
    this.query = query ?? {};
  }

  search(searchableFields: Array<Extract<keyof T, string>>): this {
    const searchTerm = this.query.searchTerm;
    if (typeof searchTerm === 'string' && searchTerm.trim()) {
      const keywords = searchTerm.trim().split(/\s+/).filter(Boolean);
      for (const keyword of keywords) {
        this.whereConditions.push({
          OR: searchableFields.map((field) => ({
            [field]: { contains: keyword, mode: 'insensitive' },
          })),
        });
      }
    }
    return this;
  }

  filter(): this {
    const copyQuery = { ...this.query };
    QueryBuilder.EXCLUDED.forEach((key) => delete copyQuery[key]);

    const entries = Object.entries(copyQuery).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    );

    if (entries.length) {
      this.whereConditions.push(
        Object.fromEntries(entries.map(([k, v]) => [k, this.castValue(v)])),
      );
    }
    return this;
  }

  sort(): this {
    const raw = this.query.sort;
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) =>
          item.startsWith('-')
            ? { [item.slice(1)]: 'desc' as const }
            : { [item]: 'asc' as const },
        );
      if (parsed.length) {
        this.orderBy = parsed;
      }
    }
    return this;
  }

  fields(): this {
    const raw = this.query.fields;
    if (typeof raw === 'string' && raw.trim()) {
      const picked = raw
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
      if (picked.length) {
        this.selectFields = Object.fromEntries(picked.map((f) => [f, true]));
      }
    }
    return this;
  }

  paginate(): this {
    const page = Number(this.query.page);
    const limit = Number(this.query.limit);
    this.page = Number.isFinite(page) && page > 0 ? page : 1;
    this.limit = Number.isFinite(limit) && limit > 0 ? limit : 10;
    return this;
  }

  getWhere(): Record<string, unknown> {
    return this.whereConditions.length ? { AND: this.whereConditions } : {};
  }

  build<A = Record<string, unknown>>(): A {
    const args: Record<string, unknown> = {
      where: this.getWhere(),
      orderBy: this.orderBy,
      skip: (this.page - 1) * this.limit,
      take: this.limit,
    };
    if (this.selectFields) {
      args.select = this.selectFields;
    }
    return args as A;
  }

  calculatePagination(totalItem: number) {
    const totalPage = Math.ceil(totalItem / this.limit) || 1;
    const currentPage = this.page;
    return {
      totalPage,
      currentPage,
      prevPage: currentPage - 1 > 0 ? currentPage - 1 : 1,
      nextPage: currentPage + 1 <= totalPage ? currentPage + 1 : totalPage,
      limit: this.limit,
      totalItem,
    };
  }

  // Query string values arrive as text, so booleans and numbers need casting.
  private castValue(value: unknown): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (
      typeof value === 'string' &&
      value.trim() !== '' &&
      !isNaN(Number(value))
    ) {
      return Number(value);
    }
    return value;
  }
}

export default QueryBuilder;
