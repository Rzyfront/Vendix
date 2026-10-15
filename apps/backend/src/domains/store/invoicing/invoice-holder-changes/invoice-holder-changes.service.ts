import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID, createHash } from 'crypto';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { FiscalScopeService } from '../../../../common/services/fiscal-scope.service';
import {
  lockHolderChangeOrder,
  assertNoHolderChangeReservation,
} from '../../orders/shared/holder-change-reservation';
import { OrderHistoryService } from '../../orders/order-history/order-history.service';
import { CustomersService } from '../../customers/customers.service';
import { CustomerFiscalIdentityValidator } from '../validators/customer-fiscal-identity.validator';
import { CreditNotesService } from '../credit-notes/credit-notes.service';
import { InvoiceFlowService } from '../invoice-flow/invoice-flow.service';
import { FiscalTransmissionLedgerService } from '../services/fiscal-transmission-ledger.service';
import { InvoiceHolderLinkService } from './invoice-holder-link.service';
import { HolderChangeAccountingService } from './holder-change-accounting.service';
import {
  HolderCustomerSnapshot,
  HolderMode,
  HolderOperation,
  holderEconomicHash,
} from './invoice-holder-change.types';

const DOCUMENT_INCLUDE = {
  invoice_items: { orderBy: { id: 'asc' as const } },
  invoice_taxes: { orderBy: { id: 'asc' as const } },
};

@Injectable()
export class InvoiceHolderChangesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notes: CreditNotesService,
    private readonly flow: InvoiceFlowService,
    private readonly ledger: FiscalTransmissionLedgerService,
    private readonly customers: CustomersService,
    private readonly identity: CustomerFiscalIdentityValidator,
    private readonly history: OrderHistoryService,
    private readonly links: InvoiceHolderLinkService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly accounting: HolderChangeAccountingService,
  ) {}

  private context() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id)
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id ?? null,
    };
  }
  private conflict(message: string): never {
    throw new VendixHttpException(
      ErrorCodes.CF_HOLDER_CHANGE_CONFLICT,
      message,
    );
  }
  private async operation(id: number) {
    const c = this.context();
    const op = await this.prisma.invoice_holder_changes.findFirst({
      where: { id, store_id: c.store_id, organization_id: c.organization_id },
    });
    if (!op) throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    return op;
  }
  async getOperation(id: number) {
    const op = await this.operation(id);
    const effects =
      await this.prisma.invoice_holder_change_accounting_effects.findMany({
        where: {
          operation_id: id,
          store_id: op.store_id,
          organization_id: op.organization_id,
        },
        select: { role: true, state: true, error_code: true },
      });
    return {
      ...op,
      customer_snapshot: undefined,
      economic_snapshot_hash: undefined,
      lease_owner: undefined,
      can_retry: [
        'retryable_error',
        'action_required',
        'waiting',
        'ready',
      ].includes(op.run_status),
      fiscal_completed: ['fiscal_completed', 'completed'].includes(op.phase),
      accounting_pending:
        op.phase === 'fiscal_completed' &&
        effects.some((e) => !['posted', 'skipped'].includes(e.state)),
      accounting_effects: effects,
    };
  }
  async getContext(invoiceId: number) {
    const c = this.context();
    const invoice = await this.prisma.invoices.findFirst({
      where: {
        id: invoiceId,
        store_id: c.store_id,
        organization_id: c.organization_id,
      },
    });
    if (!invoice) throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    const operation = await this.prisma.invoice_holder_changes.findFirst({
      where: {
        original_invoice_id: invoiceId,
        store_id: c.store_id,
        organization_id: c.organization_id,
      },
    });
    const cf = invoice.customer_tax_id === '222222222222';
    const supported =
      invoice.invoice_type === 'sales_invoice' && !invoice.financial_account_id;
    const enabled = this.links.isAdmissionEnabled(c.store_id);
    return {
      eligible: supported && enabled && !operation,
      reason: !supported
        ? 'unsupported_document'
        : !enabled
          ? 'admission_disabled'
          : operation
            ? 'existing_operation'
            : null,
      can_remake: supported && cf && enabled && !operation,
      can_release: supported && enabled && !operation,
      operation: operation ? await this.getOperation(operation.id) : null,
    };
  }
  async startManual(
    invoiceId: number,
    reason: string,
    mode: HolderMode = 'manual',
  ) {
    const id = await this.start(invoiceId, reason, mode);
    return this.resume(id);
  }
  async startPublic(
    requestId: number,
    storeId: number,
    snapshot: HolderCustomerSnapshot,
    submissionHash: string,
  ) {
    const c = this.context();
    if (c.store_id !== storeId)
      this.conflict('La solicitud pertenece a otra tienda.');
    this.validateSnapshot(snapshot);
    const request = await this.prisma.invoice_data_requests.findFirst({
      where: { id: requestId, store_id: storeId },
    });
    if (!request?.invoice_id)
      this.conflict('La solicitud no tiene una factura inequívoca.');
    if (request.submission_hash && request.submission_hash !== submissionHash)
      throw new VendixHttpException(ErrorCodes.CF_HOLDER_SUBMISSION_CONFLICT);
    const id = await this.start(
      request.invoice_id,
      'Cambio de titular solicitado por el comprador',
      'public',
      requestId,
      snapshot,
      submissionHash,
    );
    return this.resume(id);
  }
  /** Submitted legacy demand only: never sweep untouched eager pending invitations. */
  async adoptLegacySubmittedRequest(requestId: number) {
    const c = this.context();
    const request = await this.prisma.invoice_data_requests.findFirst({
      where: {
        id: requestId,
        store_id: c.store_id,
        status: 'submitted',
        submitted_at: { not: null },
      },
    });
    if (!request) return;
    const existing = await this.prisma.invoice_holder_changes.findFirst({
      where: {
        request_id: requestId,
        store_id: c.store_id,
        organization_id: c.organization_id,
      },
    });
    if (existing) return this.resume(existing.id);
    const invoices = await this.prisma.invoices.findMany({
      where: {
        store_id: c.store_id,
        organization_id: c.organization_id,
        order_id: request.order_id,
        invoice_type: 'sales_invoice',
        financial_account_id: null,
        ...(request.invoice_id ? { id: request.invoice_id } : {}),
      },
    });
    if (invoices.length !== 1)
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_LEGACY_REVIEW_REQUIRED,
      );
    const customer = await this.prisma.users.findFirst({
      where: {
        organization_id: c.organization_id,
        document_type: request.document_type as never,
        document_number: request.document_number,
      },
      include: {
        addresses: {
          where: { type: 'billing' },
          take: 1,
          orderBy: { id: 'desc' },
        },
      },
    });
    const a = customer?.addresses[0];
    if (!customer || !a)
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_LEGACY_REVIEW_REQUIRED,
      );
    const snapshot: HolderCustomerSnapshot = {
      person_type: customer.person_type ?? 'NATURAL',
      document_type: request.document_type ?? '',
      document_number: request.document_number ?? '',
      verification_digit: customer.verification_digit ?? undefined,
      first_name: request.first_name ?? undefined,
      last_name: request.last_name ?? undefined,
      legal_name: customer.legal_name ?? undefined,
      email: request.email ?? '',
      phone: request.phone ?? undefined,
      address: {
        address_line1: a.address_line1,
        city: a.city,
        state_province: a.state_province ?? '',
        country_code: a.country_code,
        municipality_code: a.municipality_code ?? '',
      },
    };
    this.validateSnapshot(snapshot);
    const hash = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');
    const id = await this.start(
      invoices[0].id,
      'Continuación de solicitud histórica enviada',
      'public',
      request.id,
      snapshot,
      hash,
      true,
    );
    return this.resume(id);
  }
  private async start(
    invoiceId: number,
    reason: string,
    mode: HolderMode,
    requestId?: number,
    snapshot?: HolderCustomerSnapshot,
    submissionHash?: string,
    legacyResume = false,
  ) {
    const c = this.context();
    const existing = await this.prisma.invoice_holder_changes.findFirst({
      where: {
        original_invoice_id: invoiceId,
        store_id: c.store_id,
        organization_id: c.organization_id,
      },
    });
    if (existing) {
      if (
        !requestId &&
        !existing.request_id &&
        existing.mode === mode &&
        existing.reason === reason?.trim()
      )
        return existing.id;
      if (requestId && existing.request_id === requestId) {
        const request = await this.prisma.invoice_data_requests.findFirst({
          where: { id: requestId, store_id: c.store_id },
        });
        if (request?.submission_hash !== submissionHash)
          throw new VendixHttpException(
            ErrorCodes.CF_HOLDER_SUBMISSION_CONFLICT,
          );
        return existing.id;
      }
      this.conflict(
        'Esta factura ya tiene una operación. Usa Continuar refacturación.',
      );
    }
    if (!legacyResume && !this.links.isAdmissionEnabled(c.store_id))
      throw new VendixHttpException(ErrorCodes.CF_HOLDER_CHANGE_DISABLED);
    if (!reason?.trim() || reason.trim().length < 5)
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_CAPTURE_INVALID,
        'Describe el motivo del cambio de titular.',
      );
    const invoice = await this.prisma.invoices.findFirst({
      where: {
        id: invoiceId,
        store_id: c.store_id,
        organization_id: c.organization_id,
      },
      include: DOCUMENT_INCLUDE,
    });
    if (
      !invoice?.order_id ||
      invoice.invoice_type !== 'sales_invoice' ||
      invoice.financial_account_id
    )
      throw new VendixHttpException(ErrorCodes.CF_HOLDER_INELIGIBLE);
    if (mode !== 'release_only' && invoice.customer_tax_id !== '222222222222')
      throw new VendixHttpException(ErrorCodes.CF_HOLDER_INELIGIBLE);
    const entity = await this.fiscalScope.findFiscalAccountingEntityId(c);
    if (entity !== invoice.accounting_entity_id)
      this.conflict('La entidad fiscal cambió. Requiere revisión.');
    return this.prisma.$transaction(async (tx) => {
      await lockHolderChangeOrder(
        tx,
        invoice.order_id!,
        c.store_id,
        c.organization_id,
      );
      const replay = await tx.invoice_holder_changes.findFirst({
        where: {
          original_invoice_id: invoiceId,
          store_id: c.store_id,
          organization_id: c.organization_id,
        },
      });
      if (replay) {
        if (
          !requestId &&
          !replay.request_id &&
          replay.mode === mode &&
          replay.reason === reason.trim()
        )
          return replay.id;
        const request = requestId
          ? await tx.invoice_data_requests.findFirst({
              where: { id: requestId, store_id: c.store_id },
            })
          : null;
        if (
          requestId &&
          replay.request_id === requestId &&
          request?.submission_hash === submissionHash
        )
          return replay.id;
        this.conflict(
          'La factura ya tiene una operación o una captura diferente.',
        );
      }
      if (requestId) {
        const cas = await tx.invoice_data_requests.updateMany({
          where: {
            id: requestId,
            store_id: c.store_id,
            status: legacyResume ? { in: ['pending', 'submitted'] } : 'pending',
            submission_hash: null,
          },
          data: {
            status: 'submitted',
            submission_hash: submissionHash,
            submitted_at: new Date(),
            first_name: snapshot?.first_name,
            last_name: snapshot?.last_name,
            document_type: snapshot?.document_type,
            document_number: snapshot?.document_number,
            email: snapshot?.email,
            phone: snapshot?.phone,
          },
        });
        if (cas.count !== 1)
          throw new VendixHttpException(
            ErrorCodes.CF_HOLDER_SUBMISSION_CONFLICT,
          );
      }
      await assertNoHolderChangeReservation(tx, invoice.order_id!, c.store_id);
      const order = await tx.orders.findFirst({
        where: { id: invoice.order_id!, store_id: c.store_id },
      });
      if (!order || order.active_financial_split_id)
        this.conflict('La orden dividida no admite este cambio.');
      const receivable = await tx.accounts_receivable.findFirst({
        where: {
          store_id: c.store_id,
          source_id: order.id,
          source_type: { in: ['order', 'credit_sale'] },
          balance: { gt: 0 },
          status: { notIn: ['paid', 'cancelled', 'written_off'] },
        },
      });
      if (receivable)
        this.conflict('La orden tiene una cuenta por cobrar abierta.');
      const refunds = await tx.refunds.count({
        where: {
          order_id: order.id,
          state: { notIn: ['failed', 'cancelled'] },
        },
      });
      const returns = await tx.return_orders.count({
        where: { related_order_id: order.id },
      });
      if (refunds || returns)
        throw new VendixHttpException(
          ErrorCodes.CF_HOLDER_ACCOUNTING_REVIEW_REQUIRED,
          'La orden tiene devoluciones o reembolsos.',
        );
      const original = await tx.invoices.findFirst({
        where: {
          id: invoiceId,
          order_id: order.id,
          store_id: c.store_id,
          organization_id: c.organization_id,
        },
        include: DOCUMENT_INCLUDE,
      });
      if (
        !original ||
        holderEconomicHash(original) !== holderEconomicHash(invoice)
      )
        throw new VendixHttpException(ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH);
      if (
        !order.grand_total.equals(
          original.total_amount.plus(original.withholding_amount),
        ) ||
        !order.tax_amount
          .plus(order.shipping_tax_amount)
          .equals(original.tax_amount) ||
        !order.discount_amount.equals(original.discount_amount)
      )
        throw new VendixHttpException(ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH);
      await this.accounting.preflight(tx, original, order.id);
      const op = await tx.invoice_holder_changes.create({
        data: {
          organization_id: c.organization_id,
          store_id: c.store_id,
          accounting_entity_id: invoice.accounting_entity_id,
          original_order_id: order.id,
          original_invoice_id: invoiceId,
          request_id: requestId,
          mode,
          purpose: 'holder_change',
          active_order_key: `${c.store_id}:${order.id}`,
          previous_customer_id: order.customer_id,
          customer_snapshot: snapshot as unknown as Prisma.InputJsonValue,
          economic_snapshot_hash: holderEconomicHash(invoice),
          reason: reason.trim(),
          created_by_user_id: c.user_id,
        },
      });
      await tx.invoice_holder_change_accounting_effects.createMany({
        data: ['credit_note', 'replacement'].map((role) => ({
          operation_id: op.id,
          organization_id: c.organization_id,
          store_id: c.store_id,
          accounting_entity_id: invoice.accounting_entity_id,
          role,
        })),
      });
      if (requestId)
        await tx.invoice_data_requests.updateMany({
          where: { id: requestId, store_id: c.store_id },
          data: { status: 'processing' },
        });
      await this.audit(tx, op, null, 'requested');
      return op.id;
    });
  }
  validateSnapshot(s: HolderCustomerSnapshot) {
    if (
      !s ||
      !s.email ||
      !s.address?.address_line1 ||
      !s.address?.municipality_code
    )
      throw new VendixHttpException(ErrorCodes.CF_HOLDER_CAPTURE_INVALID);
    const report = this.identity.validate({
      ...s,
      identification_mode: 'nominative',
      tax_responsibilities: s.fiscal_responsibilities,
      address: {
        address_line: s.address.address_line1,
        city_code: s.address.municipality_code,
        city_name: s.address.city,
        department_code: s.address.municipality_code.slice(0, 2),
        department_name: s.address.state_province,
        country_code: s.address.country_code,
      },
    });
    if (!report.emittable || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email))
      throw new VendixHttpException(ErrorCodes.CF_HOLDER_CAPTURE_INVALID);
  }
  async setCustomer(
    id: number,
    customerId?: number,
    snapshot?: HolderCustomerSnapshot,
  ) {
    const op = await this.operation(id);
    if (
      !['awaiting_customer', 'order_released', 'customer_ready'].includes(
        op.phase,
      )
    )
      this.conflict('La operación no está esperando datos de cliente.');
    if (customerId) {
      const customer = await this.prisma.users.findFirst({
        where: {
          id: customerId,
          organization_id: op.organization_id,
          store_users: { some: { store_id: op.store_id } },
        },
        include: {
          addresses: {
            where: { type: 'billing' },
            orderBy: { id: 'desc' },
            take: 1,
          },
        },
      });
      if (!customer)
        throw new VendixHttpException(ErrorCodes.CF_HOLDER_CAPTURE_INVALID);
      const a = customer.addresses[0];
      snapshot = {
        person_type: customer.person_type ?? 'NATURAL',
        document_type: customer.document_type ?? '',
        document_number: customer.document_number ?? '',
        verification_digit: customer.verification_digit ?? undefined,
        first_name: customer.first_name ?? undefined,
        last_name: customer.last_name ?? undefined,
        legal_name: customer.legal_name ?? undefined,
        email: customer.email ?? '',
        phone: customer.phone ?? undefined,
        address: {
          address_line1: a?.address_line1 ?? '',
          city: a?.city ?? '',
          state_province: a?.state_province ?? '',
          municipality_code: a?.municipality_code ?? '',
          country_code: a?.country_code ?? 'CO',
        },
      };
      if (customer.is_withholding_agent)
        throw new VendixHttpException(
          ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH,
          'El nuevo titular cambia las retenciones.',
        );
    }
    if (snapshot)
      snapshot = {
        person_type: snapshot.person_type,
        document_type: snapshot.document_type,
        document_number: snapshot.document_number,
        verification_digit: snapshot.verification_digit,
        first_name: snapshot.first_name,
        last_name: snapshot.last_name,
        legal_name: snapshot.legal_name,
        email: snapshot.email,
        phone: snapshot.phone,
        tax_regime: snapshot.tax_regime,
        fiscal_responsibilities: snapshot.fiscal_responsibilities,
        address: snapshot.address,
      };
    this.validateSnapshot(snapshot!);
    await this.persistCustomer(op, snapshot!, customerId);
    return this.getOperation(id);
  }
  private async persistCustomer(
    op: HolderOperation,
    snapshot: HolderCustomerSnapshot,
    customerId?: number,
  ) {
    this.validateSnapshot(snapshot);
    if (!customerId) {
      const result = await this.customers.resolveInlineCustomer(
        op.store_id,
        {
          person_type: snapshot.person_type,
          document_type: snapshot.document_type,
          document_number: snapshot.document_number,
          verification_digit: snapshot.verification_digit,
          first_name:
            snapshot.person_type === 'JURIDICA' ? null : snapshot.first_name,
          last_name:
            snapshot.person_type === 'JURIDICA' ? null : snapshot.last_name,
          legal_name: snapshot.legal_name,
          email: snapshot.email,
          phone: snapshot.phone,
          tax_regime: snapshot.tax_regime,
          fiscal_responsibilities: snapshot.fiscal_responsibilities,
        } as Parameters<CustomersService['resolveInlineCustomer']>[1],
        { billing_address: snapshot.address },
      );
      customerId = result.customer_id;
    }
    const customer = await this.prisma.users.findFirst({
      where: { id: customerId, organization_id: op.organization_id },
    });
    if (
      !customer ||
      customer.document_number !== snapshot.document_number ||
      customer.document_type !== snapshot.document_type ||
      customer.is_withholding_agent
    )
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH,
        'La identidad existente o sus retenciones requieren revisión.',
      );
    snapshot = {
      ...snapshot,
      tax_regime: snapshot.tax_regime ?? customer.tax_regime ?? undefined,
      fiscal_responsibilities:
        snapshot.fiscal_responsibilities ?? customer.fiscal_responsibilities,
    };
    this.validateSnapshot(snapshot);
    await this.prisma.$transaction(async (tx) => {
      await lockHolderChangeOrder(
        tx,
        op.original_order_id,
        op.store_id,
        op.organization_id,
      );
      await this.assertCurrentOperation(tx, op);
      const current = await tx.invoice_holder_changes.findFirst({
        where: {
          id: op.id,
          store_id: op.store_id,
          organization_id: op.organization_id,
        },
      });
      if (
        !current ||
        !['order_released', 'awaiting_customer', 'customer_ready'].includes(
          current.phase,
        )
      )
        this.conflict('La operación avanzó. Actualiza su estado.');
      // A fiscal address must be durable; legacy best-effort customer creation is not sufficient.
      const address = await tx.addresses.findFirst({
        where: {
          user_id: customerId,
          type: 'billing',
          address_line1: snapshot.address.address_line1,
          municipality_code: snapshot.address.municipality_code,
        },
      });
      if (!address)
        await tx.addresses.create({
          data: {
            ...snapshot.address,
            user_id: customerId,
            store_id: op.store_id,
            type: 'billing',
            is_primary: false,
          },
        });
      await tx.orders.updateMany({
        where: { id: op.original_order_id, store_id: op.store_id },
        data: {
          customer_id: customerId,
          customer_alias: null,
          updated_at: new Date(),
        },
      });
      await tx.invoice_holder_changes.updateMany({
        where: {
          id: op.id,
          store_id: op.store_id,
          organization_id: op.organization_id,
        },
        data: {
          target_customer_id: customerId,
          customer_snapshot: snapshot as unknown as Prisma.InputJsonValue,
          phase: 'customer_ready',
          run_status: 'ready',
          version: { increment: 1 },
        },
      });
      if (current.phase !== 'customer_ready')
        await this.audit(tx, op, current.phase, 'customer_ready');
    });
  }
  async resume(id: number, allowRejected = false) {
    const initial = await this.operation(id);
    if (initial.phase === 'completed') return this.getOperation(id);
    const owner = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.invoice_holder_changes.updateMany({
      where: {
        id,
        store_id: initial.store_id,
        organization_id: initial.organization_id,
        phase: { not: 'completed' },
        OR: [{ lease_expires_at: null }, { lease_expires_at: { lt: now } }],
      },
      data: {
        lease_owner: owner,
        lease_expires_at: new Date(now.getTime() + 120000),
        run_status: 'running',
        attempt_count: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (!claimed.count) return this.getOperation(id);
    try {
      for (let step = 0; step < 8; step++) {
        const op = await this.operation(id);
        if (
          op.lease_owner !== owner ||
          !op.lease_expires_at ||
          op.lease_expires_at.getTime() <= Date.now()
        )
          break;
        const progressed = await this.advance(op, allowRejected);
        if (!progressed) break;
      }
    } catch (error) {
      const failureCount =
        initial.run_status === 'retryable_error'
          ? initial.attempt_count + 1
          : 1;
      const retryable =
        !(error instanceof VendixHttpException) || error.getStatus() >= 500;
      const autoRetry = retryable && failureCount < 8;
      const code =
        error instanceof VendixHttpException
          ? error.errorCode
          : 'CF_HOLDER_TRANSIENT_FAILURE';
      const failed = await this.prisma.invoice_holder_changes.updateMany({
        where: {
          id,
          store_id: initial.store_id,
          organization_id: initial.organization_id,
          lease_owner: owner,
          lease_expires_at: { gt: new Date() },
          phase: { not: 'completed' },
        },
        data: {
          run_status: autoRetry ? 'retryable_error' : 'action_required',
          attempt_count: failureCount,
          last_error_code: code,
          last_error_message:
            error instanceof VendixHttpException
              ? String(
                  (error.getResponse() as { message?: string }).message ??
                    'Requiere revisión.',
                )
              : 'No se pudo completar el paso. Reintenta sin crear nuevos documentos.',
          next_retry_at: autoRetry
            ? new Date(
                Date.now() +
                  Math.min(3600000, 15000 * 2 ** Math.min(failureCount - 1, 8)),
              )
            : null,
        },
      });
      if (failed.count && initial.request_id)
        await this.prisma.invoice_data_requests.updateMany({
          where: {
            id: initial.request_id,
            store_id: initial.store_id,
            status: { not: 'completed' },
          },
          data: { status: 'failed' },
        });
    } finally {
      await this.prisma.invoice_holder_changes.updateMany({
        where: {
          id,
          store_id: initial.store_id,
          organization_id: initial.organization_id,
          lease_owner: owner,
        },
        data: { lease_owner: null, lease_expires_at: null },
      });
    }
    return this.getOperation(id);
  }
  private async advance(
    op: HolderOperation,
    allowRejected = false,
  ): Promise<boolean> {
    const original = await this.prisma.invoices.findFirst({
      where: {
        id: op.original_invoice_id,
        store_id: op.store_id,
        organization_id: op.organization_id,
        accounting_entity_id: op.accounting_entity_id,
      },
      include: DOCUMENT_INCLUDE,
    });
    if (!original) this.conflict('No se encuentra la factura original.');
    if (['requested', 'waiting_original_dian'].includes(op.phase)) {
      if (['draft', 'validated'].includes(original.status)) {
        // Legacy untransmitted draft remains the same document; no credit note.
        const ledger =
          await this.ledger.findAcceptedInvoiceTransmission(original);
        if (ledger) {
          await this.flow.reconcileAcceptedFromLedger(original.id, op);
          return true;
        }
        if (op.mode !== 'public')
          this.conflict(
            'El borrador histórico solo admite continuar su solicitud original.',
          );
        const uncertain = await this.prisma.fiscal_transmissions.findFirst({
          where: {
            organization_id: op.organization_id,
            accounting_entity_id: op.accounting_entity_id,
            source_type: 'invoice',
            source_id: original.id,
            transmission_status: { in: ['queued', 'submitted', 'retrying'] },
          },
        });
        if (uncertain) {
          await this.checkpoint(op, 'waiting_original_dian', 'waiting');
          return false;
        }
        return this.checkpoint(op, 'order_released');
      }
      if (original.status === 'sent') {
        await this.reconcile(original.id, op);
        await this.checkpoint(op, 'waiting_original_dian', 'waiting');
        return false;
      }
      if (original.status === 'accepted') {
        const accepted =
          await this.ledger.findAcceptedInvoiceTransmission(original);
        if (!accepted)
          this.conflict('Falta evidencia DIAN de aceptación de la factura.');
        const candidates = await this.prisma.invoices.findMany({
          where: {
            related_invoice_id: original.id,
            organization_id: op.organization_id,
            store_id: op.store_id,
            accounting_entity_id: op.accounting_entity_id,
            invoice_type: 'credit_note',
            status: { notIn: ['voided', 'cancelled'] },
          },
          include: DOCUMENT_INCLUDE,
        });
        const full = candidates.filter(
          (n) =>
            n.note_concept_code === '2' &&
            n.total_amount.equals(original.total_amount) &&
            n.subtotal_amount.equals(original.subtotal_amount) &&
            n.tax_amount.equals(original.tax_amount) &&
            n.discount_amount.equals(original.discount_amount) &&
            !n.refund_id,
        );
        if (candidates.length && (full.length !== 1 || candidates.length !== 1))
          this.conflict(
            'Las notas existentes no prueban una anulación total única.',
          );
        if (full.length) {
          if (holderEconomicHash(full[0]) !== op.economic_snapshot_hash)
            throw new VendixHttpException(
              ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH,
            );
          if (op.mode === 'release_only' && full[0].status !== 'accepted')
            this.conflict(
              'Liberar solo admite una nota crédito de anulación total ya aceptada.',
            );
          await this.accounting.preflightAdoptedCreditNote(op, full[0]);
          await this.prisma.$transaction(async (tx) => {
            await lockHolderChangeOrder(
              tx,
              op.original_order_id,
              op.store_id,
              op.organization_id,
            );
            await this.assertCurrentOperation(tx, op);
            await tx.invoice_holder_changes.updateMany({
              where: {
                id: op.id,
                store_id: op.store_id,
                organization_id: op.organization_id,
              },
              data: {
                credit_note_id: full[0].id,
                phase: 'waiting_credit_note_dian',
                run_status: 'ready',
                version: { increment: 1 },
              },
            });
            await this.audit(tx, op, op.phase, 'waiting_credit_note_dian');
          });
          return true;
        }
        if (op.mode === 'release_only')
          this.conflict(
            'Liberar requiere una nota crédito de anulación total ya aceptada.',
          );
        await this.prisma.$transaction(async (tx) => {
          await lockHolderChangeOrder(
            tx,
            op.original_order_id,
            op.store_id,
            op.organization_id,
          );
          await this.assertCurrentOperation(tx, op);
          const current = await tx.invoice_holder_changes.findFirst({
            where: {
              id: op.id,
              store_id: op.store_id,
              organization_id: op.organization_id,
            },
          });
          if (current?.credit_note_id) return;
          await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${original.id} AND store_id = ${op.store_id} AND organization_id = ${op.organization_id} FOR UPDATE`;
          await this.notes.createHolderChangeCreditNote(
            {
              related_invoice_id: original.id,
              reason: op.reason,
              note_concept_code: '2',
            },
            tx,
            op.id,
          );
          await this.audit(tx, op, op.phase, 'credit_note_draft');
        });
        return true;
      }
      if (['rejected', 'voided', 'cancelled'].includes(original.status)) {
        const ledger =
          await this.ledger.findAcceptedInvoiceTransmission(original);
        if (ledger) {
          await this.flow.reconcileAcceptedFromLedger(original.id, op);
          return true;
        }
        const uncertain = await this.prisma.fiscal_transmissions.findFirst({
          where: {
            organization_id: op.organization_id,
            accounting_entity_id: op.accounting_entity_id,
            source_type: 'invoice',
            source_id: original.id,
            transmission_status: { in: ['queued', 'submitted', 'retrying'] },
          },
        });
        if (uncertain) {
          await this.checkpoint(op, 'waiting_original_dian', 'waiting');
          return false;
        }
        return this.release(op, original.id);
      }
      this.conflict('La factura original no admite cambio de titular.');
    }
    if (['credit_note_draft', 'waiting_credit_note_dian'].includes(op.phase)) {
      if (!op.credit_note_id)
        this.conflict('La operación no tiene nota crédito durable.');
      const accepted = await this.driveDocument(
        op.credit_note_id,
        op,
        allowRejected,
      );
      if (!accepted) {
        await this.checkpoint(op, 'waiting_credit_note_dian', 'waiting');
        return false;
      }
      await this.accounting.reconcileCreditNote(op);
      return this.release(op, original.id);
    }
    if (['order_released', 'awaiting_customer'].includes(op.phase)) {
      if (!op.customer_snapshot) {
        await this.checkpoint(op, 'awaiting_customer', 'waiting');
        return false;
      }
      await this.persistCustomer(
        op,
        op.customer_snapshot as unknown as HolderCustomerSnapshot,
        op.target_customer_id ?? undefined,
      );
      return true;
    }
    if (op.phase === 'customer_ready') {
      await this.createReplacement(op, original);
      return true;
    }
    if (['replacement_draft', 'waiting_replacement_dian'].includes(op.phase)) {
      if (!op.new_invoice_id)
        this.conflict('Falta el documento de reemplazo durable.');
      if (!(await this.driveDocument(op.new_invoice_id, op, allowRejected))) {
        await this.checkpoint(op, 'waiting_replacement_dian', 'waiting');
        return false;
      }
      await this.checkpoint(op, 'fiscal_completed');
      return true;
    }
    if (op.phase === 'fiscal_completed') {
      const done = await this.accounting.reconcile(op);
      if (!done) {
        await this.checkpoint(op, 'fiscal_completed', 'retryable_error');
        return false;
      }
      await this.prisma.$transaction(async (tx) => {
        await lockHolderChangeOrder(
          tx,
          op.original_order_id,
          op.store_id,
          op.organization_id,
        );
        await this.assertCurrentOperation(tx, op);
        await tx.invoice_holder_changes.updateMany({
          where: {
            id: op.id,
            store_id: op.store_id,
            organization_id: op.organization_id,
          },
          data: {
            phase: 'completed',
            run_status: 'completed',
            active_order_key: null,
            completed_at: new Date(),
            next_retry_at: null,
            last_error_code: null,
            last_error_message: null,
            version: { increment: 1 },
          },
        });
        await this.audit(tx, op, op.phase, 'completed');
      });
      return false;
    }
    return false;
  }
  private async reconcile(id: number, op: HolderOperation) {
    await this.flow.refreshHolderFiscalStatus(id, op);
    const invoice = await this.prisma.invoices.findFirst({
      where: { id, store_id: op.store_id, organization_id: op.organization_id },
    });
    if (invoice && (await this.ledger.findAcceptedInvoiceTransmission(invoice)))
      await this.flow.reconcileAcceptedFromLedger(id, op);
  }
  private async driveDocument(
    id: number,
    op: HolderOperation,
    allowRejected = false,
  ) {
    await this.reconcile(id, op);
    let invoice = await this.prisma.invoices.findFirst({
      where: { id, store_id: op.store_id, organization_id: op.organization_id },
    });
    if (!invoice) this.conflict('Documento fiscal inexistente.');
    if (invoice.status === 'accepted')
      return !!(await this.ledger.findAcceptedInvoiceTransmission(invoice));
    if (invoice.status === 'rejected' && !allowRejected)
      this.conflict(
        'La DIAN rechazó el documento. Corrige y reintenta el mismo documento.',
      );
    if (invoice.status === 'draft') await this.flow.validate(id);
    invoice = await this.prisma.invoices.findFirst({
      where: { id, store_id: op.store_id, organization_id: op.organization_id },
    });
    if (
      invoice?.status === 'validated' ||
      (invoice?.status === 'rejected' && allowRejected)
    ) {
      if (id === op.new_invoice_id) {
        const projected = await this.prisma.invoices.findFirst({
          where: {
            id,
            store_id: op.store_id,
            organization_id: op.organization_id,
          },
          include: DOCUMENT_INCLUDE,
        });
        if (
          !projected ||
          holderEconomicHash(projected) !== op.economic_snapshot_hash
        )
          throw new VendixHttpException(ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH);
      }
      await this.flow.send(id);
    }
    await this.reconcile(id, op);
    invoice = await this.prisma.invoices.findFirst({
      where: { id, store_id: op.store_id, organization_id: op.organization_id },
    });
    return (
      invoice?.status === 'accepted' &&
      !!(await this.ledger.findAcceptedInvoiceTransmission(invoice))
    );
  }
  private async release(op: HolderOperation, originalId: number) {
    await this.prisma.$transaction(async (tx) => {
      await lockHolderChangeOrder(
        tx,
        op.original_order_id,
        op.store_id,
        op.organization_id,
      );
      await this.assertCurrentOperation(tx, op);
      const original = await tx.invoices.findFirst({
        where: {
          id: originalId,
          store_id: op.store_id,
          organization_id: op.organization_id,
        },
        include: DOCUMENT_INCLUDE,
      });
      if (!original) this.conflict('Factura original inexistente.');
      if (holderEconomicHash(original) !== op.economic_snapshot_hash)
        throw new VendixHttpException(ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH);
      if (original.status === 'accepted') {
        const nc = await tx.invoices.findFirst({
          where: {
            id: op.credit_note_id ?? -1,
            related_invoice_id: originalId,
            store_id: op.store_id,
            organization_id: op.organization_id,
            accounting_entity_id: op.accounting_entity_id,
            status: 'accepted',
            note_concept_code: '2',
            total_amount: original.total_amount,
            subtotal_amount: original.subtotal_amount,
            tax_amount: original.tax_amount,
          },
          include: DOCUMENT_INCLUDE,
        });
        if (nc && holderEconomicHash(nc) !== op.economic_snapshot_hash)
          throw new VendixHttpException(ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH);
        const evidence =
          nc &&
          (await tx.fiscal_transmissions.findFirst({
            where: {
              organization_id: op.organization_id,
              accounting_entity_id: op.accounting_entity_id,
              source_type: 'invoice',
              source_id: nc.id,
              transmission_status: 'accepted',
              dian_status: 'accepted',
            },
          }));
        if (!evidence)
          this.conflict(
            'La nota crédito aún no tiene aceptación DIAN demostrable.',
          );
      }
      if (
        original.order_id !== null &&
        original.order_id !== op.original_order_id
      )
        this.conflict('La factura cambió de orden.');
      await tx.invoices.updateMany({
        where: {
          id: originalId,
          order_id: op.original_order_id,
          store_id: op.store_id,
          organization_id: op.organization_id,
        },
        data: { order_id: null },
      });
      const changed = await tx.invoice_holder_changes.updateMany({
        where: {
          id: op.id,
          store_id: op.store_id,
          organization_id: op.organization_id,
          version: op.version,
          lease_owner: op.lease_owner,
          lease_expires_at: { gt: new Date() },
        },
        data: {
          phase: 'order_released',
          run_status: 'ready',
          released_at: new Date(),
          version: { increment: 1 },
        },
      });
      if (!changed.count)
        this.conflict('La operación avanzó. Actualiza su estado.');
      await this.audit(tx, op, op.phase, 'order_released');
    });
    return true;
  }
  private async createReplacement(
    op: HolderOperation,
    original: Prisma.invoicesGetPayload<{ include: typeof DOCUMENT_INCLUDE }>,
  ) {
    const snapshot = op.customer_snapshot as unknown as HolderCustomerSnapshot;
    this.validateSnapshot(snapshot);
    await this.prisma.$transaction(async (tx) => {
      await lockHolderChangeOrder(
        tx,
        op.original_order_id,
        op.store_id,
        op.organization_id,
      );
      await this.assertCurrentOperation(tx, op);
      const current = await tx.invoice_holder_changes.findFirst({
        where: {
          id: op.id,
          store_id: op.store_id,
          organization_id: op.organization_id,
        },
      });
      if (current?.new_invoice_id) return;
      const inPlace =
        ['draft', 'validated'].includes(original.status) &&
        original.order_id === op.original_order_id &&
        op.mode === 'public';
      const competing = await tx.invoices.count({
        where: {
          order_id: op.original_order_id,
          store_id: op.store_id,
          organization_id: op.organization_id,
          financial_account_id: null,
          invoice_type: 'sales_invoice',
          ...(inPlace ? { id: { not: original.id } } : {}),
          status: { notIn: ['voided', 'cancelled'] },
        },
      });
      if (competing) this.conflict('La orden ya tiene otra factura activa.');
      const order = await tx.orders.findFirst({
        where: { id: op.original_order_id, store_id: op.store_id },
      });
      if (
        !order ||
        order.customer_id !== op.target_customer_id ||
        order.active_financial_split_id
      )
        this.conflict('La orden no coincide con el titular aprobado.');
      if (
        !order.grand_total.equals(
          original.total_amount.plus(original.withholding_amount),
        ) ||
        !order.tax_amount
          .plus(order.shipping_tax_amount)
          .equals(original.tax_amount) ||
        !order.discount_amount.equals(original.discount_amount)
      )
        throw new VendixHttpException(ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH);
      if (holderEconomicHash(original) !== op.economic_snapshot_hash)
        throw new VendixHttpException(ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH);
      if (inPlace) {
        await tx.invoices.updateMany({
          where: {
            id: original.id,
            store_id: op.store_id,
            organization_id: op.organization_id,
            status: { in: ['draft', 'validated'] },
          },
          data: {
            customer_id: op.target_customer_id,
            customer_name:
              snapshot.legal_name ||
              `${snapshot.first_name} ${snapshot.last_name}`.trim(),
            customer_tax_id: snapshot.document_number,
            customer_document_type: snapshot.document_type,
            customer_person_type: snapshot.person_type,
            customer_email: snapshot.email,
            customer_phone: snapshot.phone ?? null,
            customer_verification_digit: snapshot.verification_digit ?? null,
            customer_tax_regime: null,
            customer_fiscal_responsibilities:
              snapshot.fiscal_responsibilities ?? Prisma.DbNull,
            customer_address: {
              address_line: snapshot.address.address_line1,
              city_code: snapshot.address.municipality_code,
              city_name: snapshot.address.city,
              department_code: snapshot.address.municipality_code.slice(0, 2),
              department_name: snapshot.address.state_province,
              country_code: snapshot.address.country_code,
            },
          },
        });
        await tx.invoice_holder_changes.updateMany({
          where: {
            id: op.id,
            store_id: op.store_id,
            organization_id: op.organization_id,
          },
          data: {
            new_invoice_id: original.id,
            phase: 'replacement_draft',
            run_status: 'ready',
            version: { increment: 1 },
          },
        });
        await this.audit(tx, op, op.phase, 'replacement_draft');
        return;
      }
      const data = this.copyScalars('invoices', original, [
        'id',
        'client_request_id',
        'invoice_number',
        'resolution_id',
        'order_id',
        'customer_id',
        'created_at',
        'updated_at',
        'cufe',
        'qr_code',
        'xml_document',
        'pdf_url',
        'provider_response',
        'sent_at',
        'accepted_at',
        'email_sent_at',
        'accounting_entry_id',
        'related_invoice_id',
        'credit_limit_reserved_at',
        'created_by_user_id',
        'issue_date',
        'due_date',
        'payment_date',
        'contingency_type',
        'contingency_declared_at',
        'contingency_deadline',
        'contingency_reason',
      ]);
      const invoice = await tx.invoices.create({
        data: {
          ...data,
          organization_id: op.organization_id,
          store_id: op.store_id,
          accounting_entity_id: op.accounting_entity_id,
          invoice_type: 'sales_invoice',
          fiscal_document_type: 'sales_invoice',
          status: 'draft',
          transmission_status: 'draft',
          dian_status: 'not_applicable',
          accounting_status: 'blocked',
          send_status: 'not_applicable',
          order_id: op.original_order_id,
          customer_id: op.target_customer_id,
          customer_name:
            snapshot.legal_name ||
            `${snapshot.first_name} ${snapshot.last_name}`.trim(),
          customer_tax_id: snapshot.document_number,
          customer_document_type: snapshot.document_type,
          customer_person_type: snapshot.person_type,
          customer_email: snapshot.email,
          customer_phone: snapshot.phone ?? null,
          customer_verification_digit: snapshot.verification_digit ?? null,
          customer_tax_regime: null,
          customer_fiscal_responsibilities:
            snapshot.fiscal_responsibilities ?? Prisma.DbNull,
          customer_address: {
            address_line: snapshot.address.address_line1,
            city_code: snapshot.address.municipality_code,
            city_name: snapshot.address.city,
            department_code: snapshot.address.municipality_code.slice(0, 2),
            department_name: snapshot.address.state_province,
            country_code: snapshot.address.country_code,
          },
          issue_date: new Date(),
          created_by_user_id: op.created_by_user_id,
        } as Prisma.invoicesUncheckedCreateInput,
      });
      const map = new Map<number, number>();
      for (const item of original.invoice_items) {
        const row = await tx.invoice_items.create({
          data: {
            ...this.copyScalars('invoice_items', item, [
              'id',
              'invoice_id',
              'created_at',
              'updated_at',
              'source_invoice_item_id',
            ]),
            invoice_id: invoice.id,
          } as Prisma.invoice_itemsUncheckedCreateInput,
        });
        map.set(item.id, row.id);
      }
      for (const tax of original.invoice_taxes)
        await tx.invoice_taxes.create({
          data: {
            ...this.copyScalars('invoice_taxes', tax, [
              'id',
              'invoice_id',
              'invoice_item_id',
              'created_at',
              'updated_at',
            ]),
            invoice_id: invoice.id,
            invoice_item_id: tax.invoice_item_id
              ? map.get(tax.invoice_item_id)
              : null,
          } as Prisma.invoice_taxesUncheckedCreateInput,
        });
      const replacement = await tx.invoices.findFirst({
        where: {
          id: invoice.id,
          store_id: op.store_id,
          organization_id: op.organization_id,
        },
        include: DOCUMENT_INCLUDE,
      });
      if (
        !replacement ||
        holderEconomicHash(replacement) !== op.economic_snapshot_hash
      )
        throw new VendixHttpException(ErrorCodes.CF_HOLDER_ECONOMIC_MISMATCH);
      await tx.invoice_holder_changes.updateMany({
        where: {
          id: op.id,
          store_id: op.store_id,
          organization_id: op.organization_id,
        },
        data: {
          new_invoice_id: invoice.id,
          phase: 'replacement_draft',
          run_status: 'ready',
          version: { increment: 1 },
        },
      });
      await this.audit(tx, op, op.phase, 'replacement_draft');
    });
  }
  private copyScalars(model: string, row: object, exclude: string[]) {
    const fields = Prisma.dmmf.datamodel.models
      .find((m) => m.name === model)!
      .fields.filter(
        (f) => f.kind !== 'object' && !f.isList && !exclude.includes(f.name),
      );
    return Object.fromEntries(
      fields
        .filter((f) => (row as Record<string, unknown>)[f.name] !== null)
        .map((f) => [f.name, (row as Record<string, unknown>)[f.name]]),
    );
  }
  private async assertCurrentOperation(
    tx: Prisma.TransactionClient,
    op: HolderOperation,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        version: number;
        lease_owner: string | null;
        lease_expires_at: Date | null;
      }>
    >`
      SELECT version, lease_owner, lease_expires_at FROM invoice_holder_changes
      WHERE id = ${op.id} AND store_id = ${op.store_id} AND organization_id = ${op.organization_id}
      FOR UPDATE`;
    const current = rows[0];
    if (
      !current ||
      current.version !== op.version ||
      current.lease_owner !== op.lease_owner ||
      (current.lease_owner &&
        (!current.lease_expires_at ||
          current.lease_expires_at.getTime() <= Date.now()))
    )
      this.conflict('La operación avanzó. Actualiza su estado.');
  }
  private async checkpoint(
    op: HolderOperation,
    phase: string,
    status = 'ready',
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockHolderChangeOrder(
        tx,
        op.original_order_id,
        op.store_id,
        op.organization_id,
      );
      const changed = await tx.invoice_holder_changes.updateMany({
        where: {
          id: op.id,
          store_id: op.store_id,
          organization_id: op.organization_id,
          version: op.version,
          lease_owner: op.lease_owner,
          lease_expires_at: { gt: new Date() },
        },
        data: {
          phase,
          run_status: status,
          attempt_count: 0,
          last_error_code: null,
          last_error_message: null,
          version: { increment: 1 },
          next_retry_at:
            status === 'waiting' ? new Date(Date.now() + 60000) : null,
        },
      });
      if (!changed.count) return false;
      if (phase === 'fiscal_completed' && op.request_id)
        await tx.invoice_data_requests.updateMany({
          where: { id: op.request_id, store_id: op.store_id },
          data: {
            status: 'completed',
            new_invoice_id: op.new_invoice_id,
            processed_at: new Date(),
          },
        });
      if (op.phase !== phase) await this.audit(tx, op, op.phase, phase);
      return true;
    });
  }
  private async audit(
    tx: Prisma.TransactionClient,
    op: HolderOperation,
    from: string | null,
    to: string,
  ) {
    await tx.fiscal_operation_events.create({
      data: {
        organization_id: op.organization_id,
        store_id: op.store_id,
        accounting_entity_id: op.accounting_entity_id,
        event_type: 'invoice_holder_change.transition',
        resource_type: 'invoice_holder_change',
        resource_id: op.id,
        previous_status: from,
        new_status: to,
        actor_user_id: op.created_by_user_id,
        metadata: {
          order_id: op.original_order_id,
          original_invoice_id: op.original_invoice_id,
          mode: op.mode,
          reason: op.reason,
        },
      },
    });
    await this.history.record(tx, {
      orderId: op.original_order_id,
      storeId: op.store_id,
      organizationId: op.organization_id,
      type:
        to === 'customer_ready'
          ? 'customer_changed'
          : 'holder_change_transition',
      actorUserId: op.created_by_user_id,
      source: 'system',
      payload: {
        holder_change_id: op.id,
        from_phase: from,
        to_phase: to,
        original_invoice_id: op.original_invoice_id,
      },
    });
  }
}
