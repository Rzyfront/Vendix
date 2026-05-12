import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateMetadataFieldDto {
  @IsEnum(['customer', 'booking', 'order'])
  entity_type: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  field_key: string;

  @IsEnum([
    'text',
    'number',
    'date',
    'select',
    'checkbox',
    'textarea',
    'file',
    'email',
    'phone',
    'url',
  ])
  field_type: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  @IsOptional()
  @IsEnum(['summary', 'detail'])
  display_mode?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  options?: any;

  @IsOptional()
  @IsString()
  default_value?: string;
}
