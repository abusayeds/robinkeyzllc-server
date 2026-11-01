import { IsEnum } from 'class-validator';
import { RosterSlotType } from '@prisma/client';

export class SetSlotDto {
  @IsEnum(RosterSlotType)
  slotType!: RosterSlotType;
}
