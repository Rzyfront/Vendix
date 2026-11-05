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
  ValidateIf,
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

/** Deposit amount ceiling: column Decimal(12, 2). */
export const DEPOSIT_AMOUNT_MAX = 9_999_999_999.99;

/**
 * Deposit and booking rules of a station (S1). Shared by create and update so both
 * validate the same way. `deposit_amount` is required whenever the policy is set to
 * something other than `none`; on update the service also checks the stored policy.
 */
export class StationDepositRulesDto {
  /** none = no deposit, optional = can be asked, required = needed to book or open. */
  @IsOptional()
  @IsIn(['none', 'optional', 'required'])
  deposit_policy?: 'none' | 'optional' | 'required';

  /** Minimum deposit; required when the policy is not `none`. */
  @ValidateIf((o: StationDepositRulesDto) => (o.deposit_policy !== undefined && o.deposit_policy !== 'none') || (o.deposit_amount !== undefined && o.deposit_amount !== null))
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(DEPOSIT_AMOUNT_MAX)
  deposit_amount?: number | null;

  /** What happens when the consumption passes the deposit. */
  @IsOptional()
  @IsIn(['recharge', 'overflow'])
  deposit_exhausted_policy?: 'recharge' | 'overflow';

  /** What happens with the leftover. */
  @IsOptional()
  @IsIn(['refund_or_credit', 'minimum_spend'])
  leftover_policy?: 'refund_or_credit' | 'minimum_spend';

  /** fixed = start and end; free = start only. */
  @IsOptional()
  @IsIn(['fixed', 'free'])
  booking_duration_mode?: 'fixed' | 'free';

  /** Minutes an unpaid hold lasts (D11). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  hold_minutes?: number;

  /** Block taken by an open-ended booking when the station has no earlier close (D9). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(2880)
  open_end_block_minutes?: number;

  /** Hours before the start up to which a cancellation returns the deposit (null = admin decides). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cancel_refund_hours?: number | null;

  /** Tax category of the "Gastos de reserva" line (null = no tax). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reservation_fee_tax_category_id?: number | null;
}

export class CreateServiceStationDto extends StationDepositRulesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsIn(['carro', 'moto', 'peluqueria', 'barberia', 'salon_belleza', 'general', 'celular', 'cava', 'cancha', 'sala', 'finca'])
  station_type?: 'carro' | 'moto' | 'peluqueria' | 'barberia' | 'salon_belleza' | 'general' | 'celular' | 'cava' | 'cancha' | 'sala' | 'finca';

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

  /**
   * Impuesto del alquiler: categoría IVA/INC con una sola tasa > 0, igual que la tarifa de
   * envío (null = sin impuesto). La elegibilidad la valida `ShippingTaxService`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rental_tax_category_id?: number | null;

  /** Modo del impuesto del alquiler: true = incluido en el precio del bloque, false = agregado encima. */
  @IsOptional()
  @IsBoolean()
  rental_tax_is_inclusive?: boolean;

  /** Formulario de Recolección de datos que se diligencia al ingresar a esta estación (null = el del servicio). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  intake_template_id?: number | null;
}

export class UpdateServiceStationDto extends StationDepositRulesDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['carro', 'moto', 'peluqueria', 'barberia', 'salon_belleza', 'general', 'celular', 'cava', 'cancha', 'sala', 'finca'])
  station_type?: 'carro' | 'moto' | 'peluqueria' | 'barberia' | 'salon_belleza' | 'general' | 'celular' | 'cava' | 'cancha' | 'sala' | 'finca';

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

  /**
   * Impuesto del alquiler: categoría IVA/INC con una sola tasa > 0, igual que la tarifa de
   * envío (null = sin impuesto). La elegibilidad la valida `ShippingTaxService`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rental_tax_category_id?: number | null;

  /** Modo del impuesto del alquiler: true = incluido en el precio del bloque, false = agregado encima. */
  @IsOptional()
  @IsBoolean()
  rental_tax_is_inclusive?: boolean;

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
