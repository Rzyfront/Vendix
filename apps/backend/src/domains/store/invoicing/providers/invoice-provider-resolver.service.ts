import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { InvoiceProviderAdapter } from './invoice-provider.interface';
import { MockInvoiceProvider } from './mock-invoice.provider';
import { DianDirectProvider } from './dian-direct/dian-direct.provider';
import { FiscalProductionReadinessService } from './fiscal-production-readiness.service';

type FiscalAccountingEntityRef = {
  id: number;
};

/**
 * Resolves the correct invoice provider for the current store at runtime.
 * Vendix's default production model is DIAN own software per fiscal entity:
 * the customer is the electronic issuer and signs with their own certificate.
 */
@Injectable()
export class InvoiceProviderResolver {
  private readonly logger = new Logger(InvoiceProviderResolver.name);

  constructor(
    private readonly mock_provider: MockInvoiceProvider,
    private readonly dian_provider: DianDirectProvider,
    private readonly fiscalScope: FiscalScopeService,
    private readonly readiness: FiscalProductionReadinessService,
  ) {}

  private isProductionRuntime(): boolean {
    return this.readiness.isProductionRuntime();
  }

  /**
   * Resolves the appropriate provider based on the fiscal entity's DIAN configuration.
   * Falls back to MockInvoiceProvider only outside production.
   */
  async resolve(params?: {
    configuration_type?: 'invoicing' | 'support_document' | 'payroll';
  }): Promise<InvoiceProviderAdapter> {
    const context = RequestContextService.getContext();
    const configuration_type = params?.configuration_type ?? 'invoicing';

    if (!context?.organization_id) {
      if (this.isProductionRuntime()) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_PROVIDER_002,
          'Organization context is required to resolve DIAN own-software configuration.',
        );
      }
      this.logger.debug('No organization context — using mock provider');
      return this.mock_provider;
    }

    let accounting_entity_id: number | null = null;
    let dian_config: {
      id: number;
      enablement_status: string;
      environment: string;
    } | null = null;

    try {
      const accounting_entity =
        (await this.fiscalScope.resolveAccountingEntityForFiscal({
          organization_id: context.organization_id,
          store_id: context.store_id ?? null,
        })) as FiscalAccountingEntityRef;
      accounting_entity_id = accounting_entity.id;

      dian_config = await this.readiness.resolveOwnSoftwareConfig({
        organization_id: context.organization_id,
        store_id: context.store_id ?? null,
        accounting_entity_id,
        configuration_type,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to check DIAN config for organization ${context.organization_id}: ${message}`,
      );
      if (this.isProductionRuntime()) {
        if (error instanceof VendixHttpException) {
          throw error;
        }
        throw new VendixHttpException(
          ErrorCodes.INVOICING_PROVIDER_002,
          'Could not verify DIAN own-software configuration for this fiscal scope.',
          {
            organization_id: context.organization_id,
            store_id: context.store_id,
            accounting_entity_id,
            configuration_type,
          },
        );
      }
    }

    if (dian_config) {
      this.logger.debug(
        `Fiscal entity ${accounting_entity_id} has DIAN own-software ${configuration_type} config (environment: ${dian_config.environment}, status: ${dian_config.enablement_status})`,
      );
      return this.dian_provider;
    }

    if (this.isProductionRuntime()) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_002,
        'No production DIAN own-software configuration is enabled for this fiscal scope.',
        {
          organization_id: context.organization_id,
          store_id: context.store_id,
          accounting_entity_id,
          configuration_type,
        },
      );
    }

    if (context.store_id) {
      this.logger.debug(
        `No active DIAN own-software config for store ${context.store_id} — using mock provider`,
      );
    }

    return this.mock_provider;
  }
}
