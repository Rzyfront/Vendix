import { IsOptional, IsString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class IcaRatesQueryDto {
  @IsOptional()
  @IsString()
  municipality_code?: string;

  @IsOptional()
  @IsString()
  department_code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 50;
}

export class IcaCalculateDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  municipality_code: string;

  @IsOptional()
  @IsString()
  ciiu_code?: string;
}

export class IcaReportQueryDto {
  @IsString()
  period: string;
}
