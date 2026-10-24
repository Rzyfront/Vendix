import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRealtimeSessionDto {
  /** G requires an owned conversation; metadata, not this request, owns identity. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversation_id?: number;

  @IsOptional()
  @IsIn(['vex', 'vexi'])
  agent_key?: 'vex' | 'vexi';

  /** Untrusted search text only. Never an authority or a persisted objective. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  intent?: string;

  /**
   * Provider voice id (e.g. `marin`). Optional — the service falls back to the
   * voice declared in the `ai_engine_configs` row so the default lives in
   * configuration, not in the client.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  voice?: string;
}
