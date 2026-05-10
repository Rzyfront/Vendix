import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { FiscalStatusService } from '../common/services/fiscal-status.service';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { FiscalObligationDetectorJob } from './fiscal-obligation-detector.job';

interface TenantEvent {
  organization_id?: number;
  store_id?: number | null;
  user_id?: number | null;
  invoice_id?: number;
  payroll_run_id?: number;
  accounting_entry_id?: number;
}

@Injectable()
export class FiscalStatusListener {
  private readonly logger = new Logger(FiscalStatusListener.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly fiscalStatus: FiscalStatusService,
    private readonly detector: FiscalObligationDetectorJob,
  ) {}

  @OnEvent('invoice.created')
  async handleInvoiceCreated(event: TenantEvent): Promise<void> {
    const tenant = await this.resolveTenant(event);
    if (!tenant) return;
    await this.detector.invalidateAndReevaluate(tenant.organization_id);
  }

  @OnEvent('invoice.accepted')
  async handleInvoiceAccepted(event: TenantEvent): Promise<void> {
    const tenant = await this.resolveTenant(event);
    if (!tenant) return;
    await this.detector.invalidateAndReevaluate(tenant.organization_id);
    await this.safeLock({
      ...tenant,
      area: 'invoicing',
      reasons: ['accepted_invoice_with_cufe'],
      changed_by_user_id: event.user_id ?? null,
    });
  }

  @OnEvent('accounting_entry.posted')
  async handleAccountingEntryPosted(event: TenantEvent): Promise<void> {
    const tenant = await this.resolveTenant(event);
    if (!tenant) return;
    await this.detector.invalidateAndReevaluate(tenant.organization_id);
    await this.safeLock({
      ...tenant,
      area: 'accounting',
      reasons: ['posted_accounting_entry'],
      changed_by_user_id: event.user_id ?? null,
    });
  }

  @OnEvent('payroll.paid')
  @OnEvent('payroll_run.settled')
  async handlePayrollSettled(event: TenantEvent): Promise<void> {
    const tenant = await this.resolveTenant(event);
    if (!tenant) return;
    await this.detector.invalidateAndReevaluate(tenant.organization_id);
    await this.safeLock({
      ...tenant,
      area: 'payroll',
      reasons: ['settled_payroll_run'],
      changed_by_user_id: event.user_id ?? null,
    });
  }

  @OnEvent('employee.created')
  @OnEvent('order.completed')
  @OnEvent('organization.fiscal_scope_changed')
  async handleDetectorInvalidation(event: TenantEvent): Promise<void> {
    const tenant = await this.resolveTenant(event);
    if (!tenant) return;
    await this.detector.invalidateAndReevaluate(tenant.organization_id);
  }

  private async safeLock(params: {
    organization_id: number;
    store_id?: number | null;
    area: 'invoicing' | 'accounting' | 'payroll';
    reasons: string[];
    changed_by_user_id?: number | null;
  }): Promise<void> {
    try {
      await this.fiscalStatus.lock({ ...params, source: 'event' });
    } catch (error: any) {
      this.logger.warn(
        `Fiscal status lock failed area=${params.area} org=${params.organization_id} store=${params.store_id ?? 'org'}: ${error?.message ?? error}`,
      );
    }
  }

  private async resolveTenant(
    event: TenantEvent,
  ): Promise<{ organization_id: number; store_id: number | null } | null> {
    if (event.organization_id) {
      return {
        organization_id: Number(event.organization_id),
        store_id: event.store_id == null ? null : Number(event.store_id),
      };
    }

    if (event.invoice_id) {
      const invoice = await this.prisma.invoices.findUnique({
        where: { id: Number(event.invoice_id) },
        select: { organization_id: true, store_id: true },
      });
      if (invoice) return invoice;
    }

    if (event.payroll_run_id) {
      const payroll = await this.prisma.payroll_runs.findUnique({
        where: { id: Number(event.payroll_run_id) },
        select: { organization_id: true, store_id: true },
      });
      if (payroll) return payroll;
    }

    if (event.accounting_entry_id) {
      const entry = await this.prisma.accounting_entries.findUnique({
        where: { id: Number(event.accounting_entry_id) },
        select: { organization_id: true, store_id: true },
      });
      if (entry) return entry;
    }

    return null;
  }
}
