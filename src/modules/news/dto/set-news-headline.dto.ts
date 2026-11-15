import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The commissioner's own headline for a post.
 *
 * Left out, or blank, clears it and the generated headline is shown again — a
 * post is never left without one.
 */
export class SetNewsHeadlineDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  headline?: string;
}
