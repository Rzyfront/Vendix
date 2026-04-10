import { IsOptional, IsDateString } from 'class-validator';

export class ReportQueryDto {
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;
}
