import { IsInt, IsString, Min, Max } from 'class-validator';

export class GenerateReportDto {
  @IsInt()
  @Min(2020)
  @Max(2099)
  fiscal_year: number;

  @IsString()
  format_code: string;
}
