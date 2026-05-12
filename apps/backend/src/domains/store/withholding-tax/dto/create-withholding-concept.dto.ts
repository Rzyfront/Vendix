import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

export class CreateWithholdingConceptDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  rate: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_uvt_threshold?: number = 0;

  @IsEnum(['purchase', 'service', 'rent', 'fees', 'other'])
  applies_to: string;

  @IsOptional()
  @IsEnum(['gran_contribuyente', 'regimen_simple', 'persona_natural', 'any'])
  supplier_type_filter?: string = 'any';
}
