import { IsObject, IsString, Matches, MaxLength } from 'class-validator';

/**
 * The user's approval of a write Vexi proposed.
 *
 * The arguments are re-sent rather than looked up from the token because the
 * token stores only a fingerprint, never the payload. That is deliberate: it
 * means the server verifies that what is being applied is byte-for-byte the
 * change that was shown, instead of trusting a server-side copy that could
 * have been minted for a different diff.
 */
export class ApplyConfirmationDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'tool must be a snake_case tool identifier',
  })
  tool!: string;

  @IsObject()
  arguments!: Record<string, unknown>;

  @IsString()
  @MaxLength(80)
  confirmation_token!: string;
}
