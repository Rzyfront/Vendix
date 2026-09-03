import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * DTO to open a new table session.
 *
 * Restaurant Suite — Fase E. The server creates a draft order via the
 * existing `OrdersService.create` (state='draft') and links it to a new
 * `table_sessions` row. The `opened_by` is taken from the request context.
 */
export class OpenTableSessionDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  table_id!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  guest_count?: number;

  /**
   * Optional customer to bind to the draft order. The retail OrderFlow
   * can hold a draft order for an anonymous table; in that case omit it.
   * If you do not pass it, server falls back to a configurable default
   * customer or to the user who opened the session.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  customer_id?: number;

  /**
   * QUI-737 (B.4) — Alias de venta con mesa (FB-21 aprobado): el alias aplica
   * también a mesas. Mutuamente excluyente con `customer_id`. `@Transform`
   * colapsa string en blanco a `undefined`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  customer_alias?: string;
}

/**
 * DTO for a single line to add to a draft order. The shape is a strict
 * subset of `CreateOrderItemDto` to keep the open-table flow simple.
 */
export class TableSessionAddItemDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  product_id!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  product_variant_id?: number;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  price_tier_id?: number;

  /**
   * QUI-653 — el plato se empaca y el cliente se lo lleva, aunque siga
   * perteneciendo al pedido y a la cuenta de esta mesa. El resultado es un
   * pedido mixto: parte se consume en la mesa, parte se lleva.
   *
   * NO se reinterpreta `orders.delivery_type`: es order-level y cambiarlo metria
   * la orden en los flujos de remision, donde no tiene nada que hacer.
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_takeaway?: boolean;

  /**
   * QUI-655 — insumos que el cliente pidio SIN, capturados al tomar el pedido.
   *
   * Es LA INTENCION, no el consumo: se registra lo que el mesero marco al agregar
   * el plato ("sin papas"), y el KDS lo muestra tachado para que el cocinero lo
   * vea sin tener que leer una nota. El consumo real se decide al confirmar en
   * cocina, y puede diferir — esa diferencia es dato de auditoria.
   *
   * Opcional por diseno: los tres caminos de captura convergen en el modal de
   * cocina y ninguno es obligatorio.
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  excluded_component_ids?: number[];

  /**
   * Nota libre del mesero por línea ("sin cebolla", "término medio",
   * "salsa aparte"). El KDS la muestra pegada al ítem y se imprime en
   * el ticket de cocina. NO es la misma dimensión que
   * `excluded_component_ids` (esa es intención estructurada sobre el
   * BOM); esta es prosa corta escrita al pedir.
   *
   * Tope de 200 caracteres (no 500) por el medio físico: el ticket
   * de cocina se imprime en papel térmico de 58 u 80 mm y el cocinero
   * la lee de reojo. Una nota de 500 caracteres no cabe y no se
   * lee; 200 es generoso para "sin cebolla, término medio, salsa
   * aparte".
   *
   * Cadena vacía se normaliza a NULL aguas abajo (en el create del
   * service): un '' guardado como nota pinta un espacio vacío en el
   * ticket y el cocinero ve "hay nota" sin contenido — peor que no
   * tenerla.
   *
   * El mismo DTO lo consume `ecommerce-tables.service.ts:528`
   * (camino del comensal pidiendo desde el QR de la mesa). Declarar
   * `notes` aquí es lo que queremos: el comensal puede pedir
   * "sin cebolla" desde su teléfono. Si ese create no persiste
   * `notes`, es bug del comensal, no del DTO.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

/**
 * DTO to add a batch of items to an existing open table session.
 *
 * The server appends the items to the draft order and updates the
 * `subtotal_amount`/`grand_total` accordingly. Stock reservation is
 * intentionally NOT performed here for `prepared` items — the consume
 * happens at fire-to-kitchen (Fase D).
 */
export class AddItemsToTableSessionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TableSessionAddItemDto)
  items!: TableSessionAddItemDto[];
}
