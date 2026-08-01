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
import { PrintFormat } from '../../settings/interfaces/store-settings.interface';

/**
 * Tope duro de órdenes por lote, común a las tres operaciones masivas
 * (`transition`, `assign-route`, `print`). El `ValidationPipe` global lo aplica
 * vía `@ArrayMaxSize` y el frontend lo espeja para bloquear la selección en vez
 * de mandar más ids de los que el backend acepta.
 *
 * ## Por qué 300 y no el 100 original
 *
 * El 100 era un tope de producto ("≈100 órdenes/día"), no una restricción
 * técnica. Nada en la cadena lo respalda:
 *
 *  - `api.vendix.online` va directo a nginx en EC2 con
 *    `proxy_read_timeout 86400s`; CloudFront solo sirve el frontend desde S3,
 *    así que no hay ALB ni CDN con un idle timeout de 60 s en medio.
 *  - El backend NO fija `requestTimeout` (`main.ts`, deliberado para no matar
 *    los SSE).
 *  - Que el operador cierre la pestaña no aborta el handler: Express no cancela
 *    la ejecución al cerrarse el socket, el bucle termina igual en el servidor.
 *
 * Medido: `print` con 300 ids = 1.4 s / 283 páginas; el generador aislado
 * despacha 800 órdenes en 0.58 s. El camino de solo lectura de `transition` con
 * 100 = 0.26 s.
 *
 * ## Lo que el tope sigue acotando
 *
 * No un fallo de la máquina, sino el **error humano**. `bulkTransition` es un
 * bucle secuencial SIN transacción global: cada iteración commitea sus efectos
 * (cancela pagos, libera reservas, commit de inventario, asientos contables
 * automáticos) antes de pasar a la siguiente. Una selección equivocada se
 * aplica entera, y el modal de pre-confirmación es el único gate — con 300
 * filas se revisa peor que con 100.
 *
 * Mitigante real: `forceOrderState` abre con `if (from === target) return
 * order`, así que si el proceso muere a mitad (deploy, OOM) reintentar no
 * duplica efectos.
 *
 * Se cambia junto a su espejo en `orders-bulk.interface.ts` del frontend — si
 * divergen, la UI deja seleccionar más de lo que el DTO acepta y el operador se
 * come un 400 de validación.
 */
export const MAX_BULK_ORDERS_IDS = 300;

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
 * El formato de papel (`pos_ticket_format`) NO va aquí: lo resuelve el backend
 * desde `store_settings`, nunca desde el cliente, así que el bulk nunca puede
 * emitir en un formato que la tienda no tiene configurado.
 */
export class BulkPrintOrdersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_ORDERS_IDS)
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];

  /**
   * @deprecated Ya no tiene efecto. El endpoint dejó de generar el documento:
   * ahora devuelve los datos y el render (y con él el número de copias, leído
   * de `store_settings.receipts.pos_ticket_copies`) ocurre en el frontend con
   * `PosTicketService`.
   *
   * Se conserva el campo porque el `ValidationPipe` global corre con
   * `forbidNonWhitelisted: true`: quitarlo haría que un cliente desplegado en
   * una versión anterior se coma un 400 por mandar una propiedad que el DTO
   * ya no declara.
   */
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

/**
 * Motivo por el que una orden quedó fuera del PDF masivo.
 *
 * - `not_found` — el id no existe o no pertenece a la tienda del contexto. El
 *   scope de Prisma ya lo filtra, así que aquí solo se nombra la diferencia
 *   entre lo pedido y lo encontrado.
 * - `non_printable_state` — la orden está `cancelled` o `refunded`. No es un
 *   fallo: es la regla de negocio pedida (no se imprime un comprobante de algo
 *   anulado o devuelto).
 * - `render_error` — la orden existe y es imprimible, pero sus datos rompieron
 *   el mapeo o el render. El backend ya no lo emite (dejó de dibujar el
 *   documento); se conserva en la unión porque es el motivo que el FRONTEND
 *   reporta cuando `PosTicketService` no puede dibujar una orden concreta, y
 *   `summarizeSkipped` lo sabe redactar.
 */
export type BulkPrintSkipReason =
  | 'not_found'
  | 'non_printable_state'
  | 'render_error';

/** Una orden excluida de la impresión, con su motivo legible. */
export class BulkPrintSkippedOrderDto {
  id: number;
  /** Ausente cuando el motivo es `not_found` (no hubo fila que leer). */
  order_number?: string;
  reason: BulkPrintSkipReason;
  /** Motivo humano-legible, listo para pintar en un toast. */
  message: string;
}

/**
 * Resultado de `bulkPrint`. No es el `BulkOrdersResultDto` común: aquí no hay
 * una operación por orden que pueda fallar a medias, hay una partición entre lo
 * que el frontend va a dibujar y lo que se descartó.
 *
 * El endpoint devuelve DATOS, no un documento. El render vive en
 * `PosTicketService` (frontend), el mismo que dibuja el tiquete post-venta del
 * POS y la previsualización de Ajustes → Recibos, de modo que la paridad de
 * formato queda garantizada por construcción en vez de por convenio.
 *
 * Invariante: `printable + skipped.length === total`, y `printable ===
 * orders.length`.
 */
export class BulkPrintResultDto {
  /** Ids pedidos por el cliente. */
  total: number;
  /** Órdenes que el frontend va a dibujar. Igual a `orders.length`. */
  printable: number;
  /**
   * Órdenes hidratadas con exactamente lo que el tiquete POS lee: líneas,
   * cliente, pago exitoso y factura DIAN aceptada. Sin tipar contra Prisma a
   * propósito: los delegates de `StorePrismaService` no propagan la inferencia
   * del `include`, así que el tipo real sería `{}` y no `any`.
   */
  orders: any[];
  /** Órdenes descartadas, completas (no truncadas: van en el body, no en una cabecera). */
  skipped: BulkPrintSkippedOrderDto[];
  /**
   * Formato de papel canónico, leído de la DB en ESTA respuesta.
   *
   * No es redundante con lo que el frontend ya tiene: `StoreSettingsFacade`
   * sirve `receipts` desde el snapshot de `vendix_auth_state`, que solo se
   * rehidrata al re-loguear. Sin este campo, cambiar el formato en Ajustes no
   * afectaría al masivo hasta el siguiente login — una regresión frente al
   * comportamiento anterior, donde el papel lo resolvía el backend.
   */
  pos_ticket_format: PrintFormat;
  /**
   * Copias por tiquete, canónicas de la DB, acotadas a [1, 5].
   *
   * Viaja por la misma razón que `pos_ticket_format`: el frontend las leería del
   * snapshot rancio. Mitigar el formato y no las copias dejaría el arreglo a
   * medias — un cambio de copias sin re-login seguiría imprimiendo el número
   * viejo y el aviso previo ("N tiquetes · P páginas") mentiría sobre el gasto
   * de papel.
   *
   * El piso es 1 y no 0: `pos_ticket_copies: 0` significa "no imprimir
   * automáticamente tras la venta", y quien pulsa "Imprimir" en el masivo pidió
   * papel de forma explícita.
   */
  pos_ticket_copies: number;
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