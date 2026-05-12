import { IsDateString, IsString, Matches } from 'class-validator';

export class RescheduleBookingDto {
  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time: string;
}
