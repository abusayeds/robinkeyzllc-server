import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CreateLeagueInviteDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;
}
