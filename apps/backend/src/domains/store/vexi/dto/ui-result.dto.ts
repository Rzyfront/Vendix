import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * What actually happened on the user's screen, reported back into the turn that
 * asked for it.
 *
 * The `result` arrives as an opaque JSON string rather than a typed object on
 * purpose: each UI command answers with its own shape (`ui_read_screen` returns a
 * screen description, `ui_add_to_cart` may return a variant picker), and the
 * consumer is a language model that reads JSON, not a service that needs the
 * fields. Typing it would mean a DTO per command and a migration every time a
 * host adds one.
 *
 * The size cap is what keeps a hostile or buggy client from pushing the real
 * conversation out of the context window with a giant DOM dump.
 */
export class UiResultDto {
  @IsString()
  @MaxLength(80)
  stream_id!: string;

  @IsString()
  @MaxLength(120)
  tool_call_id!: string;

  @IsString()
  @MaxLength(8000)
  result!: string;
}

/**
 * Optional conversation binding for an uploaded document.
 *
 * Arrives as a multipart form field, so it is a string on the wire and needs the
 * explicit `Type` coercion — `enableImplicitConversion` is not on globally, and
 * without it `@IsInt()` rejects `"12"`.
 */
export class UploadAttachmentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversation_id?: number;
}
