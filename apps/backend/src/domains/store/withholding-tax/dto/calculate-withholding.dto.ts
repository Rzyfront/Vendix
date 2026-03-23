import { IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class CalculateWithholdingDto {
  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  concept_code: string;

  @IsOptional()
  @IsString()
  supplier_type?: string;
}
