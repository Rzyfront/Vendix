import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Query of the panels' `GET .../username-availability`. The format itself is
 * NOT rejected with a 400: a malformed username answers
 * `{ available: false, reason: 'invalid' }` so the form can show it inline.
 */
export class UsernameAvailabilityQueryDto {
  @IsString()
  @MaxLength(255)
  username: string;

  /** User being edited: its own username counts as available. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  exclude_user_id?: number;
}
