import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  MinLength,
  MaxLength,
  IsIn,
} from 'class-validator';

export class CreateMetadataFieldDto {
  @IsIn(['customer', 'booking', 'order'])
  entity_type: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  field_key: string;

  @IsIn([
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
  @IsIn(['summary', 'detail'])
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
