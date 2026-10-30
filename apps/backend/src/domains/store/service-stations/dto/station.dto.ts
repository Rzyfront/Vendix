import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
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
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/** Tope de `rental_block_price`: columna Decimal(12, 2). */
export const RENTAL_BLOCK_PRICE_MAX = 9_999_999_999.99;

/**
 * El alquiler por bloque se configura o se quita completo: si llega `rental_block_minutes`
 * o `rental_block_price`, el otro tiene que venir también, ambos con valor o ambos null.
 * Va en los dos campos porque `@IsOptional` omite el validador del que llega vacío.
 */
function IsRentalBlockPair(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsRentalBlockPair',
      target: object.constructor,
      propertyName,
      options: {
        message: 'rental_block_minutes y rental_block_price deben enviarse juntos (ambos con valor o ambos null)',
        ...validationOptions,
      },
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const dto = args.object as { rental_block_minutes?: number | null; rental_block_price?: number | null };
          const minutes = dto.rental_block_minutes;
          const price = dto.rental_block_price;
          if (minutes === undefined && price === undefined) return true;
          return minutes !== undefined && price !== undefined && (minutes === null) === (price === null);
        },
      },
    });
  };
}

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

  @IsOptional()
  @IsBoolean()
  track_time?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  target_minutes?: number | null;

  /** Alquiler por bloque: minutos de cada bloque (null = sin alquiler). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  @IsRentalBlockPair()
  rental_block_minutes?: number | null;

  /** Alquiler por bloque: precio de cada bloque (null = sin alquiler). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(RENTAL_BLOCK_PRICE_MAX)
  @IsRentalBlockPair()
  rental_block_price?: number | null;

  /** Formulario de Recolección de datos que se diligencia al ingresar a esta estación (null = el del servicio). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  intake_template_id?: number | null;
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

  @IsOptional()
  @IsBoolean()
  track_time?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  target_minutes?: number | null;

  /** Alquiler por bloque: minutos de cada bloque (null = sin alquiler). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  @IsRentalBlockPair()
  rental_block_minutes?: number | null;

  /** Alquiler por bloque: precio de cada bloque (null = sin alquiler). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(RENTAL_BLOCK_PRICE_MAX)
  @IsRentalBlockPair()
  rental_block_price?: number | null;

  /** Formulario de Recolección de datos que se diligencia al ingresar a esta estación (null = el del servicio). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  intake_template_id?: number | null;
}

/** Estaciones donde se presta un servicio (vista desde el producto). */
export class SetProductStationsDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  station_ids: number[];
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
