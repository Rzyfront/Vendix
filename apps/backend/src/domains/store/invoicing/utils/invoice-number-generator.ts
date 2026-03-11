import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';

@Injectable()
export class InvoiceNumberGenerator {
  private readonly logger = new Logger(InvoiceNumberGenerator.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Atomically generates the next invoice number within the active resolution.
   * Uses a database-level atomic increment to prevent race conditions.
   */
  async generateNextNumber(resolution_id?: number): Promise<{
    invoice_number: string;
    resolution_id: number;
  }> {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }

    // Find the active resolution for the current store
    const resolution = resolution_id
      ? await this.prisma.invoice_resolutions.findFirst({
          where: {
            id: resolution_id,
            is_active: true,
            valid_from: { lte: new Date() },
            valid_to: { gte: new Date() },
          },
        })
      : await this.prisma.invoice_resolutions.findFirst({
          where: {
            is_active: true,
            valid_from: { lte: new Date() },
            valid_to: { gte: new Date() },
          },
          orderBy: { created_at: 'desc' },
        });

    if (!resolution) {
      throw new VendixHttpException(ErrorCodes.INVOICING_RESOLUTION_001);
    }

    // Check if range is exhausted
    if (resolution.current_number >= resolution.range_to) {
      throw new VendixHttpException(ErrorCodes.INVOICING_RESOLUTION_002);
    }

    // Atomic increment using Prisma update
    const updated = await this.prisma.invoice_resolutions.update({
      where: { id: resolution.id },
      data: {
        current_number: { increment: 1 },
      },
    });

    const next_number = updated.current_number;
    const invoice_number = `${resolution.prefix}${next_number}`;

    this.logger.log(
      `Generated invoice number: ${invoice_number} (resolution #${resolution.id})`,
    );

    return {
      invoice_number,
      resolution_id: resolution.id,
    };
  }
}
