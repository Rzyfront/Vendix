import { Module, OnModuleInit } from '@nestjs/common';
// H9.1 — Vexi tools of the hotel. AIToolRegistry comes from the @Global()
// AIEngineModule, so it is injectable without importing it here.
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { createLodgingTools } from '../../../../ai-engine/tools/domains/lodging.tools';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { OrderFlowModule } from '../../orders/order-flow/order-flow.module';
import { OrderHistoryModule } from '../../orders/order-history/order-history.module';
import { CashRegistersModule } from '../../cash-registers/cash-registers.module';
import { SettingsModule } from '../../settings/settings.module';
import { LodgingReservationsController } from './reservations.controller';
import { LodgingReservationsService } from './reservations.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { LodgingAvailabilityService } from './lodging-availability.service';
import { LodgingRoomChangesService } from './room-changes.service';
import { LodgingNoShowJob } from './jobs/lodging-no-show.job';
import { LodgingRackController } from './rack/rack.controller';
import { LodgingRackService } from './rack/lodging-rack.service';
import { LodgingRatesModule } from '../rates/rates.module';
import { LodgingAllotmentsController } from './allotments/allotments.controller';
import { LodgingAllotmentsService } from './allotments/allotments.service';
import { LodgingGuestsController } from './guests/guests.controller';
import { LodgingGuestsService } from './guests/guests.service';
import { LodgingPrecheckinController } from './precheckin/precheckin.controller';
import { LodgingPrecheckinService } from './precheckin/precheckin.service';
import { LodgingStayReviewService } from './stay-review/stay-review.service';
import { LodgingCheckInService } from './check-in/check-in.service';
import { LodgingFrontDeskController } from './front-desk/front-desk.controller';
import { LodgingFrontDeskService } from './front-desk/lodging-front-desk.service';
import { LodgingFolioController } from './folio/folio.controller';
import { LodgingFolioService } from './folio/folio.service';
import { LodgingNightAuditJob } from './jobs/lodging-night-audit.job';
import { LodgingGuestMessagesJob } from './guest-messages/guest-messages.job';
import { WalletModule } from '../../wallet/wallet.module';
import { PaymentLinksModule } from '../../payment-links/payment-links.module';
import { LodgingDepositsController } from './deposits/deposits.controller';
import { LodgingDepositsService } from './deposits/deposits.service';
import { OrderStockCommitModule } from '../../inventory/shared/order-stock-commit.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { TablesModule } from '../../tables/tables.module';
import { LodgingRoomChargesController } from './room-charges/room-charges.controller';
import { LodgingRoomChargesService } from './room-charges/room-charges.service';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import { AccountsReceivableModule } from '../../accounts-receivable/accounts-receivable.module';
import { LodgingCheckOutController } from './check-out/check-out.controller';
import { LodgingCheckOutService } from './check-out/check-out.service';
import { LodgingFolioSplitController } from './folio-split/folio-split.controller';
import { LodgingFolioSplitService } from './folio-split/folio-split.service';
import { LodgingInventoryBlocksController } from './blocks/inventory-blocks.controller';
import { LodgingInventoryBlocksService } from './blocks/inventory-blocks.service';

import { LodgingBookingEngineService } from './booking-engine/booking-engine.service';
import { BookingHoldExpiryJob } from './booking-engine/booking-hold-expiry.job';
import { EmailModule } from '../../../../email/email.module';
import { S3Module } from '@common/services/s3.module';
import { LodgingVatExemptServicesController } from './reports/vat-exempt-services.controller';
import { LodgingVatExemptServicesService } from './reports/vat-exempt-services.service';
import { LodgingNightAuditController } from './night-audit/night-audit.controller';
import { LodgingNightAuditService } from './night-audit/night-audit.service';
import { LodgingPerformanceController } from './reports/performance.controller';
import { LodgingPerformanceService } from './reports/performance.service';
import { LodgingPickupController } from './reports/pickup.controller';
import { LodgingPickupService } from './reports/pickup.service';
import { LodgingCancellationsController } from './reports/cancellations.controller';
import { LodgingCancellationsService } from './reports/cancellations.service';
import { LodgingKeyHandoversController } from './key-handovers/key-handovers.controller';
import { LodgingKeyHandoversService } from './key-handovers/key-handovers.service';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    LodgingRatesModule,
    // H3.4 — the folio reuses the order totals rule, order history and the
    // cash register gate of every sale.
    OrderFlowModule,
    OrderHistoryModule,
    CashRegistersModule,
    SettingsModule,
    // H3.5 — the deposit is a wallet advance, collected at the desk or with a
    // Wompi payment link.
    WalletModule,
    PaymentLinksModule,
    // H3.6 — a room charge commits stock like a paid POS sale and closes the
    // table session it came from. H3.8 — the split folio reuses the tables'
    // financial split and per-account payment.
    OrderStockCommitModule,
    InventoryModule,
    TablesModule,
    // H3.7 — the check-out emits the folio invoice and charges the company's
    // credit to receivables.
    InvoicingModule,
    AccountsReceivableModule,
    // H6.6 — the booking engine signs room photos and emails the guest.
    S3Module,
    EmailModule,
  ],
  controllers: [
    LodgingReservationsController,
    LodgingRackController,
    LodgingAllotmentsController,
    LodgingGuestsController,
    LodgingPrecheckinController,
    LodgingFrontDeskController,
    LodgingFolioController,
    LodgingDepositsController,
    LodgingRoomChargesController,
    LodgingCheckOutController,
    LodgingFolioSplitController,
    LodgingVatExemptServicesController,
    LodgingInventoryBlocksController,
    LodgingNightAuditController,
    LodgingPerformanceController,
    LodgingPickupController,
    LodgingCancellationsController,
    // H8.4 (D12) — key / access card handover log.
    LodgingKeyHandoversController,
  ],
  providers: [
    LodgingReservationsService,
    LodgingAvailabilityService,
    LodgingRoomChangesService,
    LodgingNoShowJob,
    LodgingRackService,
    LodgingAllotmentsService,
    LodgingGuestsService,
    LodgingPrecheckinService,
    LodgingStayReviewService,
    LodgingCheckInService,
    LodgingFrontDeskService,
    LodgingFolioService,
    LodgingNightAuditJob,
    // H8.2 — automatic guest emails (confirmation, pre-arrival, thank-you).
    LodgingGuestMessagesJob,
    LodgingDepositsService,
    LodgingRoomChargesService,
    LodgingCheckOutService,
    LodgingFolioSplitService,
    LodgingVatExemptServicesService,
    LodgingInventoryBlocksService,
    LodgingBookingEngineService,
    BookingHoldExpiryJob,
    LodgingNightAuditService,
    LodgingPerformanceService,
    LodgingPickupService,
    LodgingCancellationsService,
    LodgingKeyHandoversService,
  ],
  exports: [
    LodgingReservationsService,
    LodgingAvailabilityService,
    LodgingBookingEngineService,
    LodgingPrecheckinService,
    LodgingStayReviewService,
  ],
})
export class LodgingReservationsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly bookingEngine: LodgingBookingEngineService,
    private readonly reservations: LodgingReservationsService,
    private readonly deposits: LodgingDepositsService,
    private readonly guestMessages: LodgingGuestMessagesJob,
    private readonly prisma: StorePrismaService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createLodgingTools({
        bookingEngine: this.bookingEngine,
        reservations: this.reservations,
        // H9.2 — the guest named in Vexi's proposal; same store check as the sale.
        findCustomerName: async (customer_id) => {
          const store_id = RequestContextService.getContext()?.store_id;
          if (!store_id) return null;
          const user = await this.prisma.users.findFirst({
            where: { id: customer_id, store_users: { some: { store_id } } },
            select: { first_name: true, last_name: true },
          });
          return user ? `${user.first_name} ${user.last_name}`.trim() : null;
        },
        // H9.3 — the reservation whose deposit link Vexi creates.
        deposits: this.deposits,
        findReservation: async (reservation_number) => {
          const store_id = RequestContextService.getContext()?.store_id;
          if (!store_id) return null;
          const reservation = await this.prisma.lodging_reservations.findFirst({
            where: { store_id, reservation_number: { equals: reservation_number, mode: 'insensitive' } },
            select: {
              id: true,
              reservation_number: true,
              customer: { select: { first_name: true, last_name: true } },
            },
          });
          if (!reservation) return null;
          const { first_name, last_name } = reservation.customer;
          return {
            id: reservation.id,
            reservation_number: reservation.reservation_number,
            guest_name: `${first_name} ${last_name}`.trim(),
          };
        },
        // H9.4 — the pre check-in email of tomorrow's arrivals, same message as H8.2.
        guestMessages: this.guestMessages,
      }),
    );
  }
}
