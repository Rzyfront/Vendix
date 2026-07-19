import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CarrierPoolSseService } from './carrier-pool-sse.service';

/**
 * Bridges pool-mutation domain events onto the dedicated carrier pool SSE
 * channel so connected repartidores see the pool refresh in real time.
 *
 *  - `order.awaiting_carrier`: an order was published to the pool by the admin
 *    (`DispatchNotesService.sendToDispatchPool`) or re-exposed by the carrier
 *    release facade. Already emitted elsewhere — here we only fan it out to SSE.
 *  - `carrier.pool.changed`: emitted by this feature when an order LEAVES the
 *    pool (successful claim) or is cleaned up on cancel/refund.
 *
 * Both collapse to the same `{ type: 'pool_changed' }` nudge; the client simply
 * re-fetches `GET /store/carrier/pool`.
 */
@Injectable()
export class CarrierPoolSseListener {
  constructor(private readonly sse: CarrierPoolSseService) {}

  @OnEvent('order.awaiting_carrier')
  handleAwaitingCarrier(event: { store_id: number }): void {
    this.sse.push(event.store_id, { type: 'pool_changed' });
  }

  @OnEvent('carrier.pool.changed')
  handlePoolChanged(event: { store_id: number }): void {
    this.sse.push(event.store_id, { type: 'pool_changed' });
  }
}
