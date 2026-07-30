import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BusinessHoursDayDto } from './business-hours-day.dto';

/**
 * Batch upsert payload for the weekly business-hours master calendar.
 * Replaces ALL rows for the current store (callers send every day they
 * want active). Days omitted from the payload are deactivated.
 */
export class UpsertBusinessHoursDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe enviar al menos un día' })
  @ArrayMaxSize(7, { message: 'Máximo 7 días (uno por DOW)' })
  @ValidateNested({ each: true })
  @Type(() => BusinessHoursDayDto)
  items: BusinessHoursDayDto[];
}