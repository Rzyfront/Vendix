import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  LODGING_CHECKED_IN_EVENT,
  LODGING_CHECKED_OUT_EVENT,
  LodgingStayEvent,
} from '../../reservations/stay-events';
import { LodgingTraService } from './tra-submissions.service';

/**
 * Hospitality Suite (H4.1) — logs the TRA report after each check-in and
 * check-out commits. Async and caught: a failure here is only a log line,
 * never an error at the desk (D14).
 */
@Injectable()
export class LodgingTraListener {
  private readonly logger = new Logger(LodgingTraListener.name);

  constructor(private readonly tra: LodgingTraService) {}

  @OnEvent(LODGING_CHECKED_IN_EVENT, { async: true })
  async onCheckedIn(event: LodgingStayEvent): Promise<void> {
    await this.safely(event, () => this.tra.record(event.store_id, event.reservation_id, ['check_in']));
  }

  @OnEvent(LODGING_CHECKED_OUT_EVENT, { async: true })
  async onCheckedOut(event: LodgingStayEvent): Promise<void> {
    // A guest registered during the stay also gets the arrival record.
    await this.safely(event, () =>
      this.tra.record(event.store_id, event.reservation_id, ['check_in', 'check_out']),
    );
  }

  private async safely(event: LodgingStayEvent, run: () => Promise<number>): Promise<void> {
    try {
      await run();
    } catch (error: unknown) {
      this.logger.error(
        `TRA record of reservation ${event.reservation_id} (store ${event.store_id}) failed: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
}
