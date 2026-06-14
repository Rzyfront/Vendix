import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateAvailabilityWindowDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week!: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  menu_section_id?: number;
}

export class UpdateAvailabilityWindowDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week?: number;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time?: string;
}
