import {
  IsInt,
  IsDateString,
  IsString,
  IsOptional,
  Matches,
} from 'class-validator';

export class HoldBookingDto {
  @IsInt()
  product_id: number;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
