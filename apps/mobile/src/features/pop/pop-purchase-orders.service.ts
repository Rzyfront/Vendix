import { apiPatch, apiPost } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  CreatePurchaseOrderRequest,
  PopCostPreviewRequest,
  PopCostPreviewResponse,
} from './types';

/**
 * CP-PURCHASE-TRANSPARENCY — las dos llamadas de compra que el POP móvil
 * necesita y que `InventoryService` no expone.
 *
 * Vive en el feature (mismo patrón que `org-purchase-orders.service.ts`) y no
 * en el servicio de inventario porque las dos son propias de este flujo: la
 * vista previa alimenta el panel fiscal de la confirmación y la aprobación
 * cierra la cadena `draft → approved → partial` que la creación abrió.
 */

/**
 * Lo que la pantalla necesita saber de la orden recién creada.
 *
 * `purchase_order_items[].id` es OBLIGATORIO para recibir: `ReceiveItemDto.id`
 * es el id de la LÍNEA de la orden, y el backend rechaza con 400 («La línea N
 * no pertenece a esta orden de compra») cualquier id que no sea suyo.
 */
export interface PopCreatedOrder {
  id: number;
  status?: string;
  purchase_order_items?: Array<{
    id: number;
    quantity_ordered?: number;
  }>;
}

/**
 * Crea la orden de compra del POP.
 *
 * Vive acá y no en `InventoryService` porque el cuerpo del POP declara campos
 * que el DTO genérico de inventario no conoce (`shipping_cost_allocation`, el
 * bloque de insumo por línea, la unidad de venta de QUI-648). Mientras se
 * enviaba por el DTO genérico había que forzarlo con `as any`, y ese cast era
 * justamente lo que dejaba pasar el `status` que el servidor ignora.
 */
export async function createPurchaseOrder(
  body: CreatePurchaseOrderRequest,
): Promise<PopCreatedOrder> {
  return apiPost<PopCreatedOrder>(Endpoints.STORE.PURCHASE_ORDERS.CREATE, body);
}

/**
 * A.10 — lleva la orden de `draft` a `approved`.
 *
 * Es un acto con permiso propio (`store:orders:purchase_orders:approve`), no
 * una clave del cuerpo de creación: el backend estampa `approved_by_user_id`
 * y escribe la auditoría. Es OBLIGATORIO antes de recibir, porque `receive`
 * afirma la transición a `partial` y un `draft` sólo transita a `approved` o
 * `cancelled`.
 *
 * Devuelve `unknown` a propósito: la pantalla sólo necesita saber que la
 * aprobación pasó, y declarar aquí una forma parcial de la orden invitaría a
 * leer campos que este flujo no verifica.
 */
export async function approvePurchaseOrder(id: number): Promise<void> {
  await apiPatch<unknown>(
    Endpoints.STORE.PURCHASE_ORDERS.APPROVE.replace(':id', String(id)),
  );
}

/**
 * B.5 — vista previa de costeo. Su respuesta trae `fiscal_explanation`, que es
 * lo que el panel fiscal pinta sin volver a derivar nada.
 */
export async function getCostPreview(
  request: PopCostPreviewRequest,
): Promise<PopCostPreviewResponse> {
  return apiPost<PopCostPreviewResponse>(
    Endpoints.STORE.PURCHASE_ORDERS.COST_PREVIEW,
    request,
  );
}
