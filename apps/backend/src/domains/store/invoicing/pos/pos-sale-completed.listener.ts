import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { PosFiscalEmissionService } from './pos-fiscal-emission.service';
import {
  POS_SALE_COMPLETED_EVENT,
  PosSaleCompletedEvent,
} from './pos-sale-completed.event';

/**
 * Dispara la emisión fiscal de una venta de mostrador YA COBRADA.
 *
 * ## Por qué un listener y no una llamada directa
 *
 * Porque el punto exacto en que la venta se desacopla de la transmisión tiene
 * que ser visible. `processPosPayment` emite el evento después del commit y
 * sigue su camino; a partir de ahí la DIAN es problema de este archivo. Nada de
 * lo que pase aquí puede volver a la respuesta del cobro, y `@OnEvent` lo
 * garantiza por construcción: el emisor no espera al oyente.
 *
 * ## Contexto de tenant explícito
 *
 * El evento trae organización, tienda y usuario, y aquí se abre un contexto
 * AISLADO con ellos (`runIsolated`, no `run`: nunca se escribe el estático que
 * otro ejecutor fuera del ALS podría adoptar). No se confía en el contexto del
 * request porque esta continuación puede sobrevivir a la respuesta HTTP, y un
 * `store_id` que se evapora a mitad de camino produce un `Forbidden` de Prisma
 * imposible de rastrear.
 *
 * Se conserva el `user_id` —a diferencia de `StoreContextRunner`, que no lo
 * tiene— porque el documento debe quedar atribuido al cajero que cerró la venta
 * (`invoices.created_by_user_id`), igual que si lo hubiera emitido a mano.
 *
 * ## Nunca lanza
 *
 * `@OnEvent` descarta los errores del oyente por defecto, pero eso no es una
 * estrategia: aquí se capturan y se registran, porque un fallo silencioso en la
 * emisión de una venta real es exactamente lo que nadie se entera hasta la
 * declaración del mes siguiente.
 */
@Injectable()
export class PosSaleCompletedListener {
  private readonly logger = new Logger(PosSaleCompletedListener.name);

  constructor(private readonly emission: PosFiscalEmissionService) {}

  @OnEvent(POS_SALE_COMPLETED_EVENT)
  async handlePosSaleCompleted(event: PosSaleCompletedEvent): Promise<void> {
    // La tienda decide si el documento sale solo. Con `auto_emit` apagado la
    // venta queda igualmente disponible para emitir bajo demanda desde el POS:
    // no se pierde nada, sólo no se hace automáticamente.
    if (!event.auto_emit) return;

    try {
      const status = await RequestContextService.runIsolated(
        {
          user_id: event.user_id,
          organization_id: event.organization_id,
          store_id: event.store_id,
          is_super_admin: false,
          is_owner: false,
        },
        () => this.emission.emitForOrder(event.order_id),
      );

      if (status.state === 'failed') {
        this.logger.warn(
          `POS: la venta ${event.order_number ?? `#${event.order_id}`} quedó sin documento fiscal — ${status.message}`,
        );
        return;
      }

      this.logger.log(
        `POS: venta ${event.order_number ?? `#${event.order_id}`} → estado fiscal '${status.state}'` +
          (status.invoice_number ? ` (${status.invoice_number})` : ''),
      );
    } catch (error) {
      // Última línea de defensa. La venta ya está cobrada y confirmada: nada de
      // lo que ocurra acá puede tumbar el proceso ni revertir el cobro.
      this.logger.error(
        `POS: la emisión fiscal del pedido #${event.order_id} falló de forma inesperada: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
