import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsIn,
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

  @IsIn(['purchase', 'service', 'rent', 'fees', 'other'])
  applies_to: string;

  @IsOptional()
  @IsIn(['gran_contribuyente', 'regimen_simple', 'persona_natural', 'any'])
  supplier_type_filter?: string = 'any';

  @IsOptional()
  @IsIn(['retefuente', 'reteiva', 'reteica'])
  withholding_type?: string = 'retefuente';

  @IsOptional()
  @IsString()
  account_code?: string;
}
