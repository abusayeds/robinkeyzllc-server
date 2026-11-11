import { TeamIntelStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class SetTeamIntelDto {
  /**
   * Left out, or sent as null, clears the intel.
   *
   * `null` has to be allowed through rather than rejected as a missing value:
   * "clear intel" is one of the options on the dropdown, and it is the only
   * way back to having said nothing.
   */
  @IsOptional()
  @IsEnum(TeamIntelStatus)
  status?: TeamIntelStatus | null;
}
