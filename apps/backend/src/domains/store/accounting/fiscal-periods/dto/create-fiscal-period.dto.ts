import { IsString, IsDateString, MaxLength } from 'class-validator';

export class CreateFiscalPeriodDto {
  @IsString()
  @MaxLength(50)
  name: string;

  @IsDateString()
  start_date: string;

  @IsDateString()
  end_date: string;
}
