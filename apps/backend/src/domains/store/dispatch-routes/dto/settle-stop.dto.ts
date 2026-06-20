import {
  IsInt,
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsObject,
  Min,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { dispatch_route_stop_result_enum } from '@prisma/client';

export class SettleStopDto {
  @IsEnum(dispatch_route_stop_result_enum, {
    message: 'result debe ser: delivered, partial, rejected o released',
  })
  result: dispatch_route_stop_result_enum;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === ''
      ? 0
      : Number(value),
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  collected_amount?: number = 0;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === ''
      ? 0
      : Number(value),
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  anticipo_amount?: number = 0;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === ''
      ? 0
      : Number(value),
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  change_amount?: number = 0;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === ''
      ? 0
      : Number(value),
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  withholding_amount?: number = 0;

  @IsOptional()
  @IsObject()
  withholding_breakdown?: {
    retefuente?: number;
    reteiva?: number;
    reteica?: number;
  };

  @IsOptional()
  @IsString()
  @MaxLength(40)
  payment_method?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
