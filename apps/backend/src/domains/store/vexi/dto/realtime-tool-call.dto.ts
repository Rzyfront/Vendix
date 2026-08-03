import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RealtimeToolCallDto {
  /**
   * Registry tool name. Constrained to the registry's own naming shape so a
   * malformed name is rejected by validation before it reaches the lookup.
   */
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'name must be a snake_case tool identifier',
  })
  name!: string;

  @IsObject()
  arguments!: Record<string, unknown>;

  /** Correlates the result back to the provider's `function_call` item. */
  @IsString()
  @MaxLength(120)
  call_id!: string;
}

export class CloseRealtimeSessionDto {
  /**
   * Billed seconds of open session, reported by the client when the peer
   * connection closes. Capped server-side so a bad client cannot inflate a
   * store's own counter beyond one plausible session.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3600)
  duration_seconds!: number;

  /** Total audio tokens reported by the provider, for cost observability. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  total_tokens?: number;
}
