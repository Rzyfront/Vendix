import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

@Injectable()
export class SubscriptionSupportRequestService {
  private readonly logger = new Logger(SubscriptionSupportRequestService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  async createSupportRequest(
    storeId: number,
    opts: {
      reason: string;
      message: string;
      contactEmail?: string;
      userId?: number;
    },
  ): Promise<{ ticketId: number }> {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: { id: true, state: true },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const dunningStates = ['grace_soft', 'grace_hard', 'suspended', 'blocked'];
    if (!dunningStates.includes(sub.state)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_VALIDATION,
        'Support requests only available in dunning states',
      );
    }

    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true, name: true },
    });

    // Create a support ticket. The subscription context is encoded in tags
    // and the description body, since support_tickets has no metadata column.
    const orgId = store?.organization_id ?? 0;
    const ticketNumber = `SUB-${orgId}-${sub.id}-${Date.now()}`;
    const contextLines = [
      opts.message,
      '',
      `--- Subscription context ---`,
      `subscription_id: ${sub.id}`,
      `subscription_state: ${sub.state}`,
      `contact_email: ${opts.contactEmail ?? 'n/a'}`,
      `source: subscription_dunning`,
    ].join('\n');

    const ticket = await this.prisma.support_tickets.create({
      data: {
        ticket_number: ticketNumber,
        store_id: storeId,
        organization_id: orgId,
        created_by_user_id: opts.userId ?? 0,
        title: `[Subscription] ${opts.reason}`,
        description: contextLines,
        status: 'OPEN',
        priority: 'P1',
        category: 'SERVICE_REQUEST',
        tags: ['subscription', 'dunning', sub.state],
      },
    });

    this.logger.log(
      `Support ticket ${ticket.id} created for store ${storeId} in state ${sub.state}`,
    );

    return { ticketId: ticket.id };
  }
}
