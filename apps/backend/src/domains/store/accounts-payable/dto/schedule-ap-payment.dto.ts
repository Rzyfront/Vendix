import { IsDateString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ScheduleApPaymentDto {
  @IsDateString()
  scheduled_date: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;
}
