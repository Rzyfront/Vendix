import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Los seis valores de `invoice_data_request_status_enum`, verbatim.
 *
 * OBJETO Y NO ARREGLO: `@IsEnum` acepta las dos formas para VALIDAR, pero
 * construye el mensaje de error recorriendo las claves. Con un arreglo el 400
 * salía literalmente como «status must be one of the following values: » — la
 * lista vacía —, que es peor que no decir nada. Con el objeto enumera los seis.
 *
 * Se declaran acá y no en línea dentro del decorador porque el servicio los
 * reutiliza para sembrar el resumen por estado: si la lista viviera sólo en el
 * decorador, un estado nuevo entraría por el filtro y quedaría fuera de las
 * tarjetas sin que nada fallara.
 */
export const INVOICE_DATA_REQUEST_STATUS = {
  pending: 'pending',
  submitted: 'submitted',
  processing: 'processing',
  completed: 'completed',
  expired: 'expired',
  failed: 'failed',
} as const;

export type InvoiceDataRequestStatusValue =
  (typeof INVOICE_DATA_REQUEST_STATUS)[keyof typeof INVOICE_DATA_REQUEST_STATUS];

/** Los mismos seis valores como lista, para sembrar el resumen en cero. */
export const INVOICE_DATA_REQUEST_STATUSES = Object.values(
  INVOICE_DATA_REQUEST_STATUS,
) as InvoiceDataRequestStatusValue[];

/**
 * Filtros del listado de solicitudes de factura a nombre del cliente.
 *
 * Antes de este DTO el controlador leía `@Query('status') status?: string` sin
 * validar y lo pasaba tal cual a un `where` de Prisma. Un `?status=cualquiera`
 * llegaba al motor y reventaba con un error de enum inválido — 500 sobre una
 * entrada del usuario. Con `forbidNonWhitelisted: true` global
 * (`main.ts:203-206`), declarar el DTO además cierra la puerta a cualquier
 * parámetro que no esté acá.
 */
export class QueryInvoiceDataRequestsDto {
  /**
   * Estado exacto. Vacío = todas.
   *
   * El `@Transform` normaliza la cadena vacía a `undefined` porque el frontend
   * envía `?status=` cuando el usuario elige «Todos los estados», y `''` no es
   * un miembro del enum: sin esto la opción por defecto del selector devolvía
   * 400.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsEnum(INVOICE_DATA_REQUEST_STATUS)
  status?: InvoiceDataRequestStatusValue;

  /** Número de orden, nombre, documento o correo del solicitante. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /**
   * Cota superior real, no decorativa: sin `@Max` un `?limit=100000` obliga a
   * Prisma a materializar la tabla entera con su `include` de órdenes.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
