import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class PosContextDto {
  @IsOptional()
  @IsNumber()
  item_count?: number;

  @IsOptional()
  @IsNumber()
  total?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customer?: string | null;
}

class HiddenModuleDto {
  @IsString()
  @MaxLength(80)
  key!: string;

  @IsString()
  @MaxLength(40)
  blocked_by!: string;
}

/**
 * The screen the user is looking at, as reported by the browser.
 *
 * Validated for shape and size only. It is prompt material, never an
 * authorization input — see `VexiUiContext`. The length caps exist so a
 * malformed or hostile client cannot push the real conversation out of the
 * context window with a giant module list.
 */
export class UiContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visible_modules?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HiddenModuleDto)
  hidden_modules?: HiddenModuleDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PosContextDto)
  pos?: PosContextDto;
}

/**
 * Body of the handshake that precedes the SSE connection. Returns a `stream_id`
 * the browser puts in the EventSource URL, so the prompt itself never lands in
 * an access log.
 */
export class StreamIntentDto {
  @IsString()
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UiContextDto)
  ui_context?: UiContextDto;
}
