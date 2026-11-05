import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class StationRateWindowDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @IsString()
  @Matches(HHMM)
  start_time: string;

  @IsString()
  @Matches(HHMM)
  end_time: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  block_price: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  block_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class SetStationRateWindowsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StationRateWindowDto)
  windows: StationRateWindowDto[];
}

export class RentalQuoteQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variant_id?: number;

  @IsString()
  start_at: string;
}
