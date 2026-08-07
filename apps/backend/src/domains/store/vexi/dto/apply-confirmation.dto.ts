import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

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

  /**
   * The conversation the approval came from, so the applied write lands in the
   * audit trail.
   *
   * Optional because the voice surface has no conversation. Without it the write
   * still applies — it just cannot be attributed to a thread, and the activity
   * screen would show a change nobody could trace back to a request.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  conversation_id?: number;

  /**
   * Asks for the acknowledgement to come back as audio as well as text.
   *
   * Set by the panel when the person is in voice mode, because an approval given
   * by voice that answers only in writing leaves them staring at a screen they
   * were not reading.
   *
   * Note what is NOT here: any text to synthesize. The endpoint speaks the
   * `summary` the tool itself produced, so this flag cannot turn the confirmation
   * endpoint into a general text-to-speech surface — the person can ask for audio,
   * never for arbitrary audio.
   */
  @IsOptional()
  @IsBoolean()
  speak?: boolean;
}
