import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { InvoiceProviderAdapter } from './invoice-provider.interface';
import { MockInvoiceProvider } from './mock-invoice.provider';
import { DianDirectProvider } from './dian-direct/dian-direct.provider';

/**
 * Resolves the correct invoice provider for the current store at runtime.
 * If the store has an active DIAN configuration, uses DianDirectProvider.
 * Otherwise falls back to MockInvoiceProvider.
 */
@Injectable()
export class InvoiceProviderResolver {
  private readonly logger = new Logger(InvoiceProviderResolver.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly mock_provider: MockInvoiceProvider,
    private readonly dian_provider: DianDirectProvider,
  ) {}

  /**
   * Resolves the appropriate provider based on the store's DIAN configuration.
   * Checks if the store has an active DIAN config (testing or enabled).
   * Falls back to MockInvoiceProvider if not configured.
   */
  async resolve(): Promise<InvoiceProviderAdapter> {
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      this.logger.debug('No store context — using mock provider');
      return this.mock_provider;
    }

    try {
      const dian_config = await this.prisma.dian_configurations.findFirst({
        where: {
          store_id: context.store_id,
          enablement_status: { in: ['testing', 'enabled'] },
        },
        orderBy: { is_default: 'desc' },
      });

      if (dian_config) {
        this.logger.debug(
          `Store ${context.store_id} has active DIAN config (status: ${dian_config.enablement_status}) — using DIAN provider`,
        );
        return this.dian_provider;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to check DIAN config for store ${context.store_id}: ${error.message}`,
      );
    }

    return this.mock_provider;
  }
}
