import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BusinessHoursDayDto } from './business-hours-day.dto';

/**
 * Batch upsert payload for the store's single weekly schedule
 * (`settings.pos.business_hours`). Only the days sent are rewritten;
 * a day with `is_active: false` is closed, omitted days keep their hours.
 */
export class UpsertBusinessHoursDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe enviar al menos un día' })
  @ArrayMaxSize(7, { message: 'Máximo 7 días (uno por DOW)' })
  @ValidateNested({ each: true })
  @Type(() => BusinessHoursDayDto)
  items: BusinessHoursDayDto[];
}