import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** Used for both owner and co-owner: the body only ever names the user. */
export class AssignTeamMemberDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;
}
