import { IsOptional, IsNumber, IsDate, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Filtros del listado de devoluciones.
 *
 * Este DTO estaba escrito contra un esquema de `return_orders` que ya no
 * existe: prometía ocho estados (`requested`, `approved`, `received`,
 * `refunded`, `rejected`) donde `return_order_status_enum` sólo tiene tres,
 * tres tipos (`refund`, `replacement`, `credit`) donde `return_order_type_enum`
 * tiene dos, y filtros sobre columnas inexistentes (`customer_id`, `reason`,
 * `refund_amount_min/max`, `search` sobre cuatro columnas de texto que la tabla
 * no tiene, `return_date`).
 *
 * El efecto no era cosmético: cualquiera de esos valores llegaba a Prisma, que
 * respondía `PrismaClientValidationError` — un 500 «Error interno». Los tres
 * listados por estado y por tipo fallaban SIEMPRE, sin necesidad de mandar
 * ningún filtro, porque el `orderBy` fijo también apuntaba a una columna
 * inexistente.
 *
 * Ahora cada campo declarado corresponde a una columna real. Lo que la tabla no
 * puede filtrar, no se ofrece.
 */
export class ReturnOrderQueryDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  /** Valores de `return_order_status_enum`. */
  @IsOptional()
  @IsIn(['draft', 'processed', 'cancelled'])
  status?: 'draft' | 'processed' | 'cancelled';

  /** Valores de `return_order_type_enum`. */
  @IsOptional()
  @IsIn(['purchase_return', 'sales_return'])
  type?: 'purchase_return' | 'sales_return';

  /** Se filtra contra `related_order_id`, que es como se llama la columna. */
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  order_id?: number;

  /** Vía `return_order_items.some.product_id`. */
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  partner_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  related_dispatch_id?: number;

  /**
   * Rango sobre `created_at`. Se llamaba `return_date_from`/`_to` y apuntaba a
   * una columna que no existe.
   */
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_from?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_to?: Date;

  @IsOptional()
  @IsIn(['created_at', 'updated_at', 'id'])
  sort_by?: 'created_at' | 'updated_at' | 'id';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
