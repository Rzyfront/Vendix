import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRealtimeSessionDto {
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
