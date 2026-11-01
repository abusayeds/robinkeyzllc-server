import { Type } from 'class-transformer';
import { CalendarPhase } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCalendarEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsEnum(CalendarPhase)
  phase!: CalendarPhase;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isApproximate?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  time?: string | null;

  // Left out to add to the league's current season.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  season?: string;
}

export class UpdateCalendarEventDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsEnum(CalendarPhase)
  phase?: CalendarPhase;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isApproximate?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  time?: string | null;
}

export class ListCalendarDto {
  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(20)
  season?: string;
}
