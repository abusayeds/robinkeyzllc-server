import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class saveLeagueContentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  description!: string;
}
