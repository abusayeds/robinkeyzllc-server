import { IsEnum, IsOptional } from 'class-validator';
import { FreeAgencyOfferStatus } from '@prisma/client';

export class ListOffersDto {
  @IsOptional()
  @IsEnum(FreeAgencyOfferStatus)
  status?: FreeAgencyOfferStatus;
}
