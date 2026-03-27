import { IsDateString } from 'class-validator';

export class AvailabilityQueryDto {
  @IsDateString()
  date_from: string;

  @IsDateString()
  date_to: string;
}
