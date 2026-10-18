import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
  MinLength,
  ArrayUnique,
  ArrayMaxSize,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';

export class CreateServiceStationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsIn(['carro', 'moto', 'peluqueria', 'barberia', 'salon_belleza', 'general', 'celular'])
  station_type?: 'carro' | 'moto' | 'peluqueria' | 'barberia' | 'salon_belleza' | 'general' | 'celular';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1)
  capacity?: number;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class UpdateServiceStationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['carro', 'moto', 'peluqueria', 'barberia', 'salon_belleza', 'general', 'celular'])
  station_type?: 'carro' | 'moto' | 'peluqueria' | 'barberia' | 'salon_belleza' | 'general' | 'celular';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1)
  capacity?: number;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class SetStationServicesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  product_ids: number[];
}

export class SetStationProvidersDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  provider_ids: number[];
}

export class StationScheduleBlockDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  end_time: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class SetStationSchedulesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StationScheduleBlockDto)
  schedules: StationScheduleBlockDto[];
}

export class CreateStationExceptionDto {
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, {
    message: 'start_at debe incluir zona horaria explícita',
  })
  start_at: string;

  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, {
    message: 'end_at debe incluir zona horaria explícita',
  })
  end_at: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
