import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class WaivePlayerDto {
  /**
   * Rule 10.15 — spread the remaining guaranteed salary over twice the
   * remaining years plus one.
   *
   * Defaults to false: the stretch lowers this season's hit but keeps the
   * player on the books for years, so it is a choice the owner makes rather
   * than something that happens to them.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  stretch?: boolean;
}
