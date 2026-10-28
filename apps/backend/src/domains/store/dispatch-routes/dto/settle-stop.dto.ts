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

/**
 * Payload de liquidación de una parada de ruta DSD.
 *
 * NO acepta `credit_amount`: la columna no se escribe y no existe el resultado
 * `partial`. Regla de pago por parada entregada: contra entrega y crédito libre
 * (`credit_type` 'free' o null) exigen recaudo + anticipo + retención >= total
 * (o la parada es prepaga); una orden a crédito POR CUOTAS
 * (`payment_form` '2' + `credit_type` 'installments') se entrega con cualquier
 * recaudo, incluido 0: lo cobrado abona las cuotas y la CxC y el saldo sigue en
 * cartera. Si el cliente no paga y no hay cuotas, se marca `rejected`. El
 * `ValidationPipe` global corre con `whitelist: true` +
 * `forbidNonWhitelisted: true` (ver `main.ts`), así que enviar `credit_amount`
 * produce un 400 en validación en vez de colarse hasta el servicio. La columna
 * `dispatch_route_stops.credit_amount` sigue en el schema (siempre 0) porque
 * retirarla exigiría una migración destructiva; no es input ni output del settle.
 *
 * `result` acepta solo `delivered`, `rejected` y `released`. El valor `partial`
 * existe en el enum de Postgres por datos históricos, pero `settleStop` lo
 * rechaza con `DISPATCH_ROUTE_PARTIAL_DISABLED`.
 *
 * Ojo con el nivel: la restricción es por PARADA. Una RUTA sí cierra
 * normalmente con unas paradas entregadas y otras rechazadas o liberadas — no
 * lograr entregar todo no es un error.
 */
export class SettleStopDto {
  @IsEnum(dispatch_route_stop_result_enum, {
    message: 'result debe ser: delivered, rejected o released',
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
