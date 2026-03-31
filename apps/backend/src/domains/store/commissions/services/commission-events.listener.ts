import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommissionCalculatorService } from './commission-calculator.service';

@Injectable()
export class CommissionEventsListener {
  private readonly logger = new Logger(CommissionEventsListener.name);

  constructor(
    private readonly calculator: CommissionCalculatorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('payment.received')
  async handlePaymentReceived(event: {
    payment_id: number;
    store_id: number;
    organization_id: number;
    amount: number;
    payment_method: string;
  }) {
    try {
      const result = await this.calculator.calculateForPayment({
        payment_id: event.payment_id,
        amount: Number(event.amount),
        payment_method: event.payment_method,
        store_id: event.store_id,
      });

      if (result) {
        this.eventEmitter.emit('commission.calculated', {
          store_id: event.store_id,
          organization_id: event.organization_id,
          payment_id: event.payment_id,
          commission_amount: result.commission_amount,
          rule_id: result.rule_id,
        });
        this.logger.log(
          `Commission ${result.commission_amount} calculated for payment #${event.payment_id}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to calculate commission for payment #${event.payment_id}: ${error.message}`,
        error.stack,
      );
    }
  }
}
