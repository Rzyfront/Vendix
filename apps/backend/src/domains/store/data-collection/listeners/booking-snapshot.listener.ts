import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { MetadataValuesService } from '../../metadata/metadata-values.service';

@Injectable()
export class BookingSnapshotListener {
  private readonly logger = new Logger(BookingSnapshotListener.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly metadataValues: MetadataValuesService,
  ) {}

  @OnEvent('booking.completed')
  async onBookingCompleted(event: {
    store_id: number;
    booking_id: number;
    customer_id: number;
  }) {
    try {
      // Check if snapshot already exists
      const existing = await this.prisma.booking_metadata_snapshots.findUnique({
        where: { booking_id: event.booking_id },
      });
      if (existing) return;

      // Get current customer metadata
      const values = await this.metadataValues.getValuesByStoreAndEntity(
        event.store_id,
        'customer',
        event.customer_id,
      );

      const snapshot = values.map((v: any) => ({
        field_key: v.field?.field_key,
        label: v.field?.label,
        field_type: v.field?.field_type,
        display_mode: v.field?.display_mode,
        value: v.value_text ?? v.value_number ?? v.value_bool ?? v.value_date ?? v.value_json,
      }));

      await this.prisma.booking_metadata_snapshots.create({
        data: {
          store_id: event.store_id,
          booking_id: event.booking_id,
          customer_id: event.customer_id,
          snapshot: snapshot,
        },
      });

      this.logger.log(`Created metadata snapshot for booking ${event.booking_id}`);
    } catch (error: any) {
      this.logger.error(`Failed to create snapshot for booking ${event.booking_id}: ${error.message}`);
    }
  }
}
