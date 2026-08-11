import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Identifies the recording currently in progress so its chunks can be
 * reassembled.
 *
 * Client-generated rather than server-issued: the first chunk leaves the browser
 * milliseconds after the button goes down, and a round-trip to mint an id would
 * spend the very latency the chunked upload exists to save. Safe because the id
 * is namespaced by the authenticated user before it ever reaches a buffer, so it
 * addresses nothing outside the caller's own turn.
 *
 * Charset is restricted so the value can never be read as a path or a key
 * separator once it is concatenated into the buffer key.
 */
export class VoiceChunkDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'turn_id solo admite letras, números, guion y guion bajo',
  })
  turn_id!: string;
}

/**
 * Closes a recording and asks for its transcription.
 *
 * `turn_id` is optional: a recording short enough to fit in one piece never
 * streamed a chunk, and requiring an id there would force the client to open a
 * buffer it does not need.
 */
export class VoiceTranscribeDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'turn_id solo admite letras, números, guion y guion bajo',
  })
  turn_id?: string;
}
