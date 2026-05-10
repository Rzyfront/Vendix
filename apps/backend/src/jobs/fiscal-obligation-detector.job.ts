import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../common/redis/redis.module';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { FiscalStatusService } from '../common/services/fiscal-status.service';
import type { FiscalDetectorSignals } from '../common/interfaces/fiscal-status.interface';

const UVT_REVENUE_THRESHOLD = 3500;
const TRANSACTION_COUNT_THRESHOLD = 120;
const B2B_INVOICE_SHARE_THRESHOLD = 0.25;
const CACHE_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class FiscalObligationDetectorJob {
  private readonly logger = new Logger(FiscalObligationDetectorJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly fiscalStatus: FiscalStatusService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('0 3 * * *')
  async handleNightlyDetection(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Fiscal obligation detector already running, skipping');
      return;
    }

    this.isRunning = true;
    try {
      const organizations = await this.prisma.organizations.findMany({
        where: { state: { in: ['active', 'draft'] } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });

      for (const organization of organizations) {
        await this.detectOrganization(organization.id);
      }
    } catch (error: any) {
      this.logger.error(
        `Fiscal obligation detector failed: ${error?.message ?? error}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  async detectOrganization(organization_id: number): Promise<void> {
    const organization = await this.prisma.organizations.findUnique({
      where: { id: organization_id },
      select: { id: true, fiscal_scope: true },
    });
    if (!organization) return;

    const stores = await this.prisma.stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const targets =
      organization.fiscal_scope === 'ORGANIZATION'
        ? [null]
        : stores.map((store) => store.id);
    const cachePayload: Record<string, FiscalDetectorSignals> = {};

    for (const store_id of targets) {
      const signals = await this.calculateSignals(organization_id, store_id);
      await this.fiscalStatus.applyDetectorSignals({
        organization_id,
        store_id,
        signals,
      });
      cachePayload[store_id === null ? 'organization' : String(store_id)] =
        signals;
    }

    await this.redis.set(
      this.cacheKey(organization_id),
      JSON.stringify({
        organization_id,
        evaluated_at: new Date().toISOString(),
        fiscal_scope: organization.fiscal_scope,
        targets: cachePayload,
      }),
      'EX',
      CACHE_TTL_SECONDS,
    );
  }

  async invalidateAndReevaluate(
    organization_id: number,
    delayMs = 5000,
  ): Promise<void> {
    await this.redis.del(this.cacheKey(organization_id));
    setTimeout(() => {
      this.detectOrganization(organization_id).catch((error: any) =>
        this.logger.warn(
          `Deferred fiscal detection failed for org=${organization_id}: ${error?.message ?? error}`,
        ),
      );
    }, delayMs);
  }

  private async calculateSignals(
    organization_id: number,
    store_id: number | null,
  ): Promise<FiscalDetectorSignals> {
    const currentYear = new Date().getFullYear();
    const tenantWhere: Record<string, unknown> = { organization_id };
    if (store_id !== null) tenantWhere.store_id = store_id;

    const [
      organization,
      uvt,
      revenue,
      transactionCount,
      invoiceCount,
      b2bInvoiceCount,
      activeEmployees,
    ] = await Promise.all([
      this.prisma.organizations.findUnique({
        where: { id: organization_id },
        select: { tax_id: true, account_type: true, legal_name: true },
      }),
      this.prisma.uvt_values.findFirst({
        where: { organization_id, year: currentYear },
        select: { value_cop: true },
      }),
      this.prisma.invoices.aggregate({
        where: {
          ...tenantWhere,
          invoice_type: 'sales_invoice',
          status: { in: ['sent', 'accepted'] },
        } as any,
        _sum: { total_amount: true },
      }),
      this.prisma.orders.count({
        where: {
          store_id: store_id ?? undefined,
          stores: store_id === null ? { organization_id } : undefined,
          state: { in: ['delivered', 'finished'] },
        } as any,
      }),
      this.prisma.invoices.count({
        where: {
          ...tenantWhere,
          invoice_type: 'sales_invoice',
          status: { not: 'cancelled' },
        } as any,
      }),
      this.prisma.invoices.count({
        where: {
          ...tenantWhere,
          invoice_type: 'sales_invoice',
          status: { not: 'cancelled' },
          customer_tax_id: { not: null },
        } as any,
      }),
      this.prisma.employees.count({
        where: { organization_id, status: 'active' },
      }),
    ]);

    const uvtValue = uvt ? Number(uvt.value_cop) : 0;
    const revenueCop = Number(revenue._sum.total_amount || 0);
    const b2bShare =
      invoiceCount > 0 ? Number(b2bInvoiceCount) / Number(invoiceCount) : 0;

    return {
      revenue_over_uvt:
        uvtValue > 0 && revenueCop >= uvtValue * UVT_REVENUE_THRESHOLD,
      transaction_volume: transactionCount >= TRANSACTION_COUNT_THRESHOLD,
      b2b_invoices:
        invoiceCount >= 3 && b2bShare >= B2B_INVOICE_SHARE_THRESHOLD,
      legal_person: Boolean(organization?.tax_id || organization?.legal_name),
      active_employees: activeEmployees > 0,
      evaluated_at: new Date().toISOString(),
    };
  }

  private cacheKey(organization_id: number): string {
    return `fiscal:detector:org:${organization_id}:v1`;
  }
}
