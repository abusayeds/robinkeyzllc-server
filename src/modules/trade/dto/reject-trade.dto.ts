import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectTradeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
