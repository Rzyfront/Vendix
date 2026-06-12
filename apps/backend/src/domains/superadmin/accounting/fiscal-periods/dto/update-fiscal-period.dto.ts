import { IsString, IsOptional, IsDateString, MaxLength } from 'class-validator';

export class UpdateFiscalPeriodDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;
}
