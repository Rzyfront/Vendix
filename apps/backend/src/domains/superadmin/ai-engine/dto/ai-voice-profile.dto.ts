import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** BCP-47-ish tag: `es`, `es-CO`, `en-US`. */
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** Body of `POST superadmin/ai-engine/voices`. */
export class CreateAIVoiceProfileDto {
  /** Speech provider config (`ai_engine_configs`, model_type = speech). */
  @IsInt()
  @Min(1)
  config_id: number;

  /** The provider's own identifier of the voice. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  voice_id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @Matches(LANGUAGE_PATTERN, {
    message: 'language debe ser un código como "es" o "es-CO".',
  })
  language?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speed?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  vol?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sample_text?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/** Body of `PATCH superadmin/ai-engine/voices/:id`. Every field optional. */
export class UpdateAIVoiceProfileDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  config_id?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  voice_id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(LANGUAGE_PATTERN, {
    message: 'language debe ser un código como "es" o "es-CO".',
  })
  language?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speed?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  vol?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sample_text?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
