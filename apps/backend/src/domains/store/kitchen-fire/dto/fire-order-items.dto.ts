import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsIn,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO to fire a list of order_items to the kitchen.
 *
 * Fase D of the Restaurant Suite — the seam that triggers the inventory
 * consume + COGS auto-entry. Items not flagged as `prepared` are accepted
 * by the service but skipped at the kitchen-fire layer (no recipe to
 * explode). Idempotent: re-firing the same `order_item_id` is a no-op.
 */
/**
 * QUI-655 — componentes excluidos de UN item del envío.
 *
 * Lo produce el modal de confirmación de cocina: el cocinero desmarca lo que no
 * se va a usar y solo lo que queda marcado se consume y se costea.
 */
export class FireItemExclusionDto {
  @IsInt()
  @Type(() => Number)
  order_item_id!: number;

  /**
   * Productos-componente a excluir del BOM de este item. El backend VALIDA que
   * cada uno pertenezca realmente al BOM explotado del plato: el cliente no
   * puede excluir un producto arbitrario, o el consumo dejaría de reflejar la
   * receta.
   */
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  component_product_ids!: number[];

  /**
   * QUI-655 — a cuantas unidades de la linea aplica la exclusion.
   *
   * Omitido o >= `quantity` significa TODA la linea, que es el caso simple. Cuando
   * es menor, el backend PARTE la linea antes de consumir: `quantity: 3` con la
   * excepcion en 1 pasa a `quantity: 2` (receta completa) + `quantity: 1` (con la
   * exclusion). Asi cada linea queda HOMOGENEA y todo el pipeline sigue funcionando
   * sin aprender a iterar unidades.
   *
   * Es el caso normal y no el borde: una mesa pide tres del mismo plato y solo un
   * comensal tiene la restriccion.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  applies_to_units?: number;
}

export class FireOrderItemsDto {
  @IsInt()
  @Type(() => Number)
  order_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Type(() => Number)
  order_item_ids!: number[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * QUI-655 — exclusiones confirmadas en el modal, por item.
   *
   * Opcional y ausente por defecto: no mandar nada equivale a "todos los
   * componentes marcados", que es el comportamiento previo. Así el envío rápido
   * de hora pico no paga el costo de enumerar recetas completas.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FireItemExclusionDto)
  exclusions?: FireItemExclusionDto[];
}

/**
 * Query DTO for the KDS tickets listing endpoint.
 *
 * The KDS subscribes to the kitchen ticket stream and renders
 * `pending | in_preparation` by default; this query is the explicit REST
 * fallback for re-connecting clients.
 */
export class KitchenTicketQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'in_preparation', 'ready', 'delivered', 'cancelled'])
  status?:
    | 'pending'
    | 'in_preparation'
    | 'ready'
    | 'delivered'
    | 'cancelled';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  order_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 50;
}

/**
 * Query DTO for the KDS snapshot — used both by the explicit REST
 * fallback and as the warm-up payload of the SSE stream.
 *
 *   windowMinutes: how far back to include non-terminal tickets
 *                  (pending/in_preparation/ready). Default 120min
 *                  covers a typical lunch/dinner service.
 */
export class KdsSnapshotQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(720)
  windowMinutes?: number = 120;
}

/**
 * QUI-762 — body del reenvio de un plato a cocina SIN volver a consumir
 * insumos.
 *
 * Hereda los dos campos de `FireOrderItemsDto` (`order_id`,
 * `order_item_ids`) y agrega `reason`, OBLIGATORIO, sin valor por
 * defecto. La eleccion la hace el operador en el modal de UI segun el
 * caso de uso real:
 *
 *   `lost_command`: la comanda original no llego a cocina (impresora
 *     rota, comanda perdida, etc). El ticket viejo se CANCELA junto con
 *     sus items en la misma transaccion, y se crea el nuevo. Asi el
 *     historial refleja UNA coccion real.
 *
 *   `remake_dish`: el cliente devolvio el plato y se rehace. Ambos
 *     tickets quedan vivos y la cocina cocina DOS veces. El historial
 *     refleja DOS cocciones reales.
 *
 * Un valor por defecto reintroduce el caso ambiguo (comportamiento (a)
 * de la discusion 2026-08-30) para todo llamador que no se actualice:
 * el ticket viejo queda en pending, el nuevo tambien, y el orden detail
 * reporta dos estados divergentes para el mismo order_item. Por eso
 * `reason` es REQUIRED y validado por el DTO — la UI obliga a elegir.
 */
export class ResendOrderItemsDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  order_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Type(() => Number)
  order_item_ids!: number[];

  /**
   * Por que se reenvia. Sin default: si no viene, el DTO rechaza con 422
   * `property reason should not exist` o `reason must be one of: ...`
   * segun el caso. Esto es deliberado, no un descuido.
   */
  @IsIn(['lost_command', 'remake_dish'])
  reason!: 'lost_command' | 'remake_dish';
}
