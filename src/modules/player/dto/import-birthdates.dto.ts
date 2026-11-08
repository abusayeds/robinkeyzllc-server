import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ImportBirthdatesDto {
  /** Check the file and report what would happen, without writing anything. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun?: boolean;
}
