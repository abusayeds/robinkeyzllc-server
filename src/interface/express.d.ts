import type { TAuthUser, TLeagueContext } from './auth.interface';

// AuthGuard sets `user` and LeagueGuard sets `league`, so controllers and
// param decorators can read both off the request without casting.
declare global {
  namespace Express {
    interface Request {
      user?: TAuthUser;
      league?: TLeagueContext;
    }
  }
}
