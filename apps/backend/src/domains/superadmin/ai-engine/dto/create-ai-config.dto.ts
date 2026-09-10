import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  IsIn,
  IsUrl,
  IsObject,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  AIModelType,
  SdkType,
} from '../../../../ai-engine/interfaces/ai-provider.interface';

/**
 * Must stay in step with the `switch` in `AIEngineService.initializeProvider`.
 *
 * An accepted value the switch does not know logs a warning at load time and
 * silently registers no provider, so the row saves cleanly and every call
 * against it fails later with "no provider configured" — far from the field that
 * caused it.
 */
export const AI_SDK_TYPES: readonly SdkType[] = [
  'openai_compatible',
  'anthropic_compatible',
  'minimax_t2a',
] as const;

export const AI_MODEL_TYPES: readonly AIModelType[] = [
  'text',
  'image',
  'embedding',
  'audio',
  'video',
  'rerank',
  'speech',
  'transcription',
] as const;

/**
 * Embedding keys managed by the superadmin config modal (B.2,
 * CP-embeddings-openrouter; consumed by OpenAICompatibleProvider
 * `settings?.embedding_model` / `settings?.encoding_format`).
 *
 * `settings` stays an open bag: any other key (thinking, pricing,
 * temperature, ...) passes through to storage untouched. A strict nested
 * DTO would 400/strip those keys under the global `forbidNonWhitelisted`
 * pipe (FB-01), so only the known keys are type-checked, and only when
 * present.
 */
export interface AIConfigSettings {
  embedding_model?: string;
  dimensions?: number;
  encoding_format?: string;
  [key: string]: any;
}

function isNonEmptyString(value: unknown, maxLength: number): boolean {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
  );
}

@ValidatorConstraint({ name: 'AIConfigSettingsKeys', async: false })
export class AIConfigSettingsKeysConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    const settings = value as Record<string, unknown>;
    if (
      settings.embedding_model !== undefined &&
      !isNonEmptyString(settings.embedding_model, 255)
    ) {
      return false;
    }
    // FB-02: dimensions must stay a JSON number (e.g. 1536), never the
    // string a text input would send — the provider forwards it as-is.
    if (
      settings.dimensions !== undefined &&
      (typeof settings.dimensions !== 'number' ||
        !Number.isInteger(settings.dimensions) ||
        settings.dimensions < 1)
    ) {
      return false;
    }
    if (
      settings.encoding_format !== undefined &&
      !isNonEmptyString(settings.encoding_format, 50)
    ) {
      return false;
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    return (
      `${args.property} has an invalid embedding key: embedding_model and ` +
      `encoding_format must be non-empty strings, dimensions must be a ` +
      `positive integer`
    );
  }
}

export function IsAIConfigSettings(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsAIConfigSettings',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: AIConfigSettingsKeysConstraint,
    });
  };
}

export class CreateAIConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  provider: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(AI_SDK_TYPES)
  sdk_type: SdkType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model_id: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false }, { message: 'base_url must be a valid URL' })
  @MaxLength(500)
  base_url?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  api_key_ref?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(AI_MODEL_TYPES)
  model_type?: AIModelType;

  @IsOptional()
  @IsObject()
  @IsAIConfigSettings()
  settings?: AIConfigSettings;
}
