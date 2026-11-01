import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** Rule 2.3 — the five figures the Super Admin enters each league year. */
export class CapYearDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  salaryCap!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  luxuryTax!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  firstApron!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  secondApron!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  averagePlayerSalary!: number;
}
