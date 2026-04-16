import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TemplatesService } from '../templates.service';
import { SubmissionsService } from '../submissions.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

@Injectable()
export class BookingDataCollectionListener {
  private readonly logger = new Logger(BookingDataCollectionListener.name);

  constructor(
    private readonly templatesService: TemplatesService,
    private readonly submissionsService: SubmissionsService,
    private readonly prisma: StorePrismaService,
  ) {}

  @OnEvent('booking.confirmed')
  async onBookingConfirmed(event: {
    store_id: number;
    booking_id: number;
    product_id: number;
    customer_id: number;
  }) {
    try {
      // Load product to check consultation config
      const product = await this.prisma.withoutScope().products.findUnique({
        where: { id: event.product_id },
        select: { is_consultation: true, send_preconsultation: true, consultation_template_id: true, preconsultation_template_id: true },
      });

      let templateId: number | null = null;

      if (product?.is_consultation && product.preconsultation_template_id) {
        // Consultation product: use preconsultation template for patient form
        if (!product.send_preconsultation) {
          this.logger.debug(`Product ${event.product_id} is consultation but send_preconsultation is disabled`);
          return;
        }
        templateId = product.preconsultation_template_id;
      } else {
        // Non-consultation: fall back to junction table lookup
        const template = await this.templatesService.getTemplateForProduct(event.product_id);
        if (!template) {
          this.logger.debug(`No data collection template found for product ${event.product_id}`);
          return;
        }
        templateId = template.id;
      }

      const submission = await this.submissionsService.createSubmission({
        template_id: templateId!,
        booking_id: event.booking_id,
        customer_id: event.customer_id,
      });

      this.logger.log(
        `Auto-created submission ${submission.id} for booking ${event.booking_id} (template ${templateId})`,
      );
    } catch (error) {
      this.logger.error(`Failed to auto-create submission for booking ${event.booking_id}: ${error.message}`);
    }
  }
}
