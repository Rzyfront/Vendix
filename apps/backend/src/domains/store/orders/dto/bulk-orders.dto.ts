import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { order_state_enum } from '@prisma/client';

/**
 * Tope duro de órdenes por lote. Hereda del mismo valor conceptual de
 * `MAX_BULK_EDIT_IDS` de QUI-567 (productos): el `ValidationPipe` global lo
 * aplica vía `@ArrayMaxSize` y el frontend lo reutiliza para truncar la
 * selección en vez de mandar más ids de los que el backend acepta.
 *
 * 100 órdenes por lote cubre el caso de uso reportado (≈100 órdenes/día) sin
 * abrir un vector de DoS por payload gigante.
 */
export const MAX_BULK_ORDERS_IDS = 100;

/**
 * Estados destino permitidos en el carril masivo. El servicio delega en
 * `OrderFlowService.forceOrderState`, que ya enruta cada destino al método
 * canónico con efectos completos (cancelar pagos, liberar reservas, emitir
 * `order.shipped` / `order.status_changed`, commit de inventario). Esta lista
 * acota lo que el endpoint expone: `draft`, `created`, `pending_payment`,
 * `processing` y `refunded` son transiciones internas que no tienen botón
 * masivo en la UI y que un caller no debería poder disparar en lote sin
 * motivo de negocio.
 *
 * El `forceOrderState` ya es idempotente (mismo estado → no-op) y audita la
 * forzada en `internal_notes._flow_metadata.forced_transition`, así que el
 * carril masivo hereda ambas garantías sin re-implementarlas.
 */
export type BulkOrderTransitionTarget =
  | 'finished'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

/**
 * Cuerpo de `POST /store/orders/bulk/transition`.
 *
 * `reason` viaja al `forceOrderState` y termina en
 * `internal_notes._flow_metadata.forced_transition.reason`: la auditoría del
 * carril forzado exige un motivo, igual que el botón manual individual.
 */
export class BulkTransitionOrdersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_ORDERS_IDS)
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];

  @IsEnum(order_state_enum, {
    message:
      'targetState debe ser uno de: finished, shipped, delivered, cancelled',
  })
  targetState: BulkOrderTransitionTarget;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Cuerpo de `POST /store/orders/bulk/assign-route`.
 *
 * Orquesta dos seams existentes en orden: por cada id de orden crea la
 * remisión vía `DispatchNotesService.createFromOrdersBatch` (que ya validaba
 * estado / stock / duplicados), y luego llama una sola vez a
 * `DispatchRoutesService.addStops(route_id, {dispatch_note_ids})` para añadir
 * todas las remisiones generadas a la planilla en un único paso.
 *
 * `route_id` es el destino de los stops. La creación de la planilla misma
 * sigue fuera del alcance del bulk (se hace desde el módulo de rutas), así
 * que este DTO solo recibe el id al que asignar.
 */
export class BulkAssignRouteDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_ORDERS_IDS)
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];

  @IsInt()
  @Min(1)
  @Type(() => Number)
  route_id: number;
}

/**
 * Cuerpo de `POST /store/orders/bulk/print`.
 *
 * `copies` opcional sobreescribe `store_settings.receipts.invoice_copies` /
 * `pos_ticket_copies` cuando el operador necesita un número distinto para esa
 * impresión puntual (p. ej. imprimir 2 copias de 100 órdenes para archivo +
 * cliente). Cuando se omite, el builder respeta la configuración de la
 * tienda.
 *
 * El formato de papel (`invoice_format` / `pos_ticket_format`) NO va aquí: se
 * resuelve desde `store_settings` en el builder, nunca desde el cliente, así
 * que el bulk nunca puede emitir en un formato que la tienda no tiene
 * configurado.
 */
export class BulkPrintOrdersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_ORDERS_IDS)
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  copies?: number;
}

/**
 * Estado de una fila dentro de un resultado masivo. No hay `warning` en la
 * aplicación real (a diferencia del preview de productos): una orden o se
 * transiciona / imprime / asigna, o no.
 */
export type BulkOrderItemStatus = 'ok' | 'error';

/** Resultado por orden tras una operación masiva. */
export class BulkOrderResultItemDto {
  id: number;
  status: BulkOrderItemStatus;
  /** Código de error estable cuando `status === 'error'`. */
  code?: string;
  /** Mensaje humano-legible del fallo o confirmación. */
  message?: string;
}

/** Resultado agregado de cualquier operación masiva de órdenes. */
export class BulkOrdersResultDto {
  total: number;
  successful: number;
  failed: number;
  results: BulkOrderResultItemDto[];
}

// ===========================================================================
// Pre-confirmación (dry-run) — QUI-599
// ===========================================================================

/**
 * Veredicto por orden en el dry-run. A diferencia del resultado real, aquí sí
 * hay cuatro estados, porque el operador necesita distinguir *por qué* una
 * orden no va a moverse:
 *
 * - `ok` — la transición es canónica según `VALID_TRANSITIONS`. Se aplicará.
 * - `warning` — se aplicará, pero por el carril FORZADO: el destino no es una
 *   arista válida desde el estado actual, así que queda auditado como forzada
 *   en `internal_notes._flow_metadata.forced_transition`.
 * - `skipped` — no se tocará y no es un fallo: la orden ya está en el estado
 *   destino (`forceOrderState` es idempotente y hace no-op), o ya tiene la
 *   remisión que se le iba a crear. Este es el caso "seleccioné 100 y 30 ya
 *   estaban finalizadas".
 * - `error` — no se podrá aplicar: la orden no existe en el scope, o una regla
 *   de dominio lo impide (estado no despachable, venta en mostrador, sin
 *   dirección de envío).
 */
export type BulkOrderPreviewStatus = 'ok' | 'warning' | 'skipped' | 'error';

/**
 * Fila del dry-run. Lleva `order_number` y `current_state` para que el modal
 * pueda nombrar la orden sin una segunda ronda de peticiones — el frontend ya
 * hidrata su stack, pero el preview puede incluir ids que su caché no alcanzó.
 */
export class BulkOrderPreviewItemDto {
  id: number;
  order_number: string;
  current_state: string;
  status: BulkOrderPreviewStatus;
  /** Código estable del motivo. Presente salvo en `ok`. */
  code?: string;
  /** Motivo humano-legible. Es lo que se pinta en el modal. */
  message?: string;
}

/**
 * Resultado del dry-run. Los cuatro contadores son la cabecera del modal:
 * `applicable = ok + warnings` es lo que realmente se va a escribir, y es el
 * número que gobierna si el botón de confirmar está habilitado.
 */
export class BulkOrdersPreviewResultDto {
  total: number;
  ok: number;
  warnings: number;
  skipped: number;
  errors: number;
  items: BulkOrderPreviewItemDto[];
}