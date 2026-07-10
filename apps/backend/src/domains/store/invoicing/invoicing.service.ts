import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { FiscalGateService } from '@common/services/fiscal-gate.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { InvoiceNumberGenerator } from './utils/invoice-number-generator';
import { InvoiceRetryQueueService } from './services/invoice-retry-queue.service';

/**
 * Listing rows whose send/transmission state is an error or a pending send get
 * their `retry_status` resolved from invoice_retry_queue (batch, no N+1).
 */
const RETRY_ELIGIBLE_SEND_STATUSES = ['pending', 'sending', 'sent_error'];
const RETRY_ELIGIBLE_TRANSMISSION_STATUSES = [
  'queued',
  'signing',
  'signed',
  'submitted',
  'rejected',
  'error',
];

const INVOICE_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: true,
  customer: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
  supplier: {
    select: {
      id: true,
      name: true,
      tax_id: true,
      document_type: true,
      tax_regime: true,
      verification_digit: true,
      addresses: {
        select: {
          address_line1: true,
          address_line2: true,
          city: true,
          state_province: true,
          country_code: true,
          postal_code: true,
          municipality_code: true,
          phone_number: true,
        },
      },
    },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  related_invoice: {
    select: {
      id: true,
      invoice_number: true,
      invoice_type: true,
      accounting_entity_id: true,
      status: true,
      cufe: true,
      issue_date: true,
    },
  },
};

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly invoice_number_generator: InvoiceNumberGenerator,
    private readonly event_emitter: EventEmitter2,
    private readonly fiscalScope: FiscalScopeService,
    private readonly retry_queue: InvoiceRetryQueueService,
    private readonly fiscalGate: FiscalGateService,
  ) {}

  /**
   * Defensa en profundidad del gate fiscal de FACTURACIÓN a nivel servicio.
   *
   * El ModuleFlowGuard bloquea la entrada HTTP y send()/accept() ya validan en
   * InvoiceFlowService, pero create()/createFromOrder()/createFromSalesOrder()
   * también son invocados por rutas internas que NO pasan por el controller
   * (invoice-data-requests, remisiones de despacho, futura auto-emisión POS).
   * Sin este gate esos callers crearían facturas saltándose el master switch
   * `fiscal_status.invoicing`. Fail-closed ante área inactiva.
   *
   * Usa el MISMO criterio (ACTIVE || LOCKED, vía FiscalGateService.isAreaEnabled)
   * y el MISMO error que InvoiceFlowService.assertInvoicingAreaActive
   * (invoice-flow.service.ts) para no divergir del gate de send/accept.
   */
  private async assertInvoicingAreaActive(context: {
    organization_id?: number;
    store_id?: number;
  }): Promise<void> {
    const enabled = await this.fiscalGate.isAreaEnabled(
      Number(context.organization_id),
      context.store_id != null ? Number(context.store_id) : null,
      'invoicing',
    );
    if (!enabled) {
      throw new ForbiddenException(
        'Fiscal area "invoicing" is inactive for this tenant',
      );
    }
  }

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async resolveAccountingEntityIdForContext(context: {
    organization_id?: number;
    store_id?: number;
  }): Promise<number> {
    if (
      typeof context.organization_id !== 'number' ||
      typeof context.store_id !== 'number'
    ) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    const entity = await this.fiscalScope.resolveAccountingEntityForFiscal({
      organization_id: context.organization_id,
      store_id: context.store_id,
    });

    return entity.id;
  }

  private async assertFiscalPeriodOpen(
    accounting_entity_id: number,
    issue_date: Date,
    action: string,
  ): Promise<void> {
    const fiscal_date = new Date(
      Date.UTC(
        issue_date.getUTCFullYear(),
        issue_date.getUTCMonth(),
        issue_date.getUTCDate(),
      ),
    );
    const closed = await this.prisma.fiscal_close_sessions.findFirst({
      where: {
        accounting_entity_id,
        status: 'closed',
        period_start: { lte: fiscal_date },
        period_end: { gte: fiscal_date },
      },
      select: {
        id: true,
        period_year: true,
        period_month: true,
        closed_at: true,
      },
    });

    if (!closed) return;

    throw new VendixHttpException(
      ErrorCodes.FISCAL_ACCOUNTING_BLOCKED,
      `Cannot ${action} fiscal document because the fiscal period is closed.`,
      {
        accounting_entity_id,
        fiscal_close_session_id: closed.id,
        period_year: closed.period_year,
        period_month: closed.period_month,
        issue_date: fiscal_date.toISOString().split('T')[0],
        closed_at: closed.closed_at,
      },
    );
  }

  private toFiscalDocumentType(invoice_type: string) {
    if (invoice_type === 'purchase_invoice') return 'support_document';
    if (invoice_type === 'export_invoice') return 'sales_invoice';
    return invoice_type as
      | 'sales_invoice'
      | 'credit_note'
      | 'debit_note'
      | 'support_document'
      | 'support_adjustment_note';
  }

  private isSupportDocumentType(invoice_type: string): boolean {
    return (
      invoice_type === 'purchase_invoice' ||
      invoice_type === 'support_document' ||
      invoice_type === 'support_adjustment_note'
    );
  }

  private async loadSupportDocumentSupplier(dto: CreateInvoiceDto) {
    if (!this.isSupportDocumentType(dto.invoice_type)) return null;
    if (!dto.supplier_id) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
        'Support documents require a supplier.',
      );
    }

    const supplier = await this.prisma.suppliers.findFirst({
      where: { id: dto.supplier_id },
      select: {
        id: true,
        name: true,
        tax_id: true,
        document_type: true,
        tax_regime: true,
        verification_digit: true,
        addresses: {
          select: {
            address_line1: true,
            address_line2: true,
            city: true,
            state_province: true,
            country_code: true,
            postal_code: true,
            municipality_code: true,
            phone_number: true,
          },
        },
      },
    });

    if (!supplier?.tax_id) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
        'Support document supplier requires tax_id.',
        { supplier_id: dto.supplier_id },
      );
    }

    return supplier;
  }

  private async loadSupportAdjustmentOriginal(
    dto: CreateInvoiceDto,
    accounting_entity_id: number,
  ) {
    if (dto.invoice_type !== 'support_adjustment_note') return null;
    if (!dto.related_invoice_id) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'Support adjustment notes require the original support document.',
      );
    }

    return this.findAcceptedSupportDocumentOriginal(
      dto.related_invoice_id,
      accounting_entity_id,
    );
  }

  private async findAcceptedSupportDocumentOriginal(
    related_invoice_id: number,
    accounting_entity_id: number,
  ) {
    const original = await this.prisma.invoices.findFirst({
      where: {
        id: related_invoice_id,
        accounting_entity_id,
        invoice_type: { in: ['purchase_invoice', 'support_document'] as any },
      },
      select: {
        id: true,
        invoice_number: true,
        invoice_type: true,
        status: true,
        cufe: true,
      },
    });

    if (!original) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'Original support document was not found in this fiscal entity.',
        { related_invoice_id },
      );
    }

    if (original.status !== 'accepted' || !original.cufe) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_002,
        'Original support document must be accepted by DIAN before creating an adjustment note.',
        {
          related_invoice_id: original.id,
          status: original.status,
          has_cuds: Boolean(original.cufe),
        },
      );
    }

    return original;
  }

  async findAll(query: QueryInvoiceDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      status,
      invoice_type,
      date_from,
      date_to,
      customer_id,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.invoicesWhereInput = {
      ...(search && {
        OR: [
          {
            invoice_number: { contains: search, mode: 'insensitive' as const },
          },
          { customer_name: { contains: search, mode: 'insensitive' as const } },
          {
            customer_tax_id: { contains: search, mode: 'insensitive' as const },
          },
          { notes: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status: status as any }),
      ...(invoice_type && { invoice_type: invoice_type as any }),
      ...(customer_id && { customer_id }),
      ...(date_from && {
        issue_date: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.invoices.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          customer: {
            select: { id: true, first_name: true, last_name: true },
          },
          resolution: {
            select: { id: true, prefix: true, resolution_number: true },
          },
          created_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
      }),
      this.prisma.invoices.count({ where }),
    ]);

    // Paso 13 — retry_status: resolve queue state for invoices in an error or
    // pending-send state with ONE batch query over the page IDs (no N+1).
    const retry_candidate_ids = data
      .filter(
        (invoice: any) =>
          RETRY_ELIGIBLE_SEND_STATUSES.includes(invoice.send_status) ||
          RETRY_ELIGIBLE_TRANSMISSION_STATUSES.includes(
            invoice.transmission_status,
          ),
      )
      .map((invoice: any) => invoice.id);

    const retry_status_map =
      await this.retry_queue.getRetryStatusByInvoiceIds(retry_candidate_ids);

    const data_with_retry = data.map((invoice: any) => ({
      ...invoice,
      retry_status: retry_status_map.get(invoice.id) ?? null,
    }));

    return {
      data: data_with_retry,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id },
      include: INVOICE_INCLUDE,
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    }

    return invoice;
  }

  async create(dto: CreateInvoiceDto) {
    const context = this.getContext();
    await this.assertInvoicingAreaActive(context);
    const accounting_entity_id =
      await this.resolveAccountingEntityIdForContext(context);
    const issue_date = new Date(dto.issue_date);
    await this.assertFiscalPeriodOpen(
      accounting_entity_id,
      issue_date,
      'create',
    );
    const support_supplier = await this.loadSupportDocumentSupplier(dto);
    const support_adjustment_original =
      await this.loadSupportAdjustmentOriginal(dto, accounting_entity_id);

    // Generate invoice number from resolution
    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber({
        resolution_id: dto.resolution_id,
        document_type: this.toFiscalDocumentType(dto.invoice_type),
        accounting_entity_id,
      });

    // Calculate amounts from items
    const { subtotal, discount, tax, total } = this.calculateAmounts(dto.items);

    const invoice = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id,
        fiscal_document_type: this.toFiscalDocumentType(dto.invoice_type),
        invoice_number,
        invoice_type: dto.invoice_type,
        status: 'draft',
        customer_id: dto.customer_id,
        supplier_id: dto.supplier_id,
        customer_name: dto.customer_name ?? support_supplier?.name,
        customer_tax_id: dto.customer_tax_id ?? support_supplier?.tax_id,
        customer_address: dto.customer_address ?? support_supplier?.addresses,
        related_invoice_id: support_adjustment_original?.id,
        resolution_id,
        subtotal_amount: new Prisma.Decimal(subtotal),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        withholding_amount: new Prisma.Decimal(dto.withholding_amount || 0),
        total_amount: new Prisma.Decimal(total),
        currency: dto.currency || 'COP',
        issue_date,
        due_date: dto.due_date ? new Date(dto.due_date) : null,
        created_by_user_id: context.user_id,
        notes: dto.notes,
        invoice_items: {
          create: dto.items.map((item) => {
            const item_total =
              item.quantity * item.unit_price -
              (item.discount_amount || 0) +
              (item.tax_amount || 0);
            return {
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              description: item.description,
              quantity: new Prisma.Decimal(item.quantity),
              unit_price: new Prisma.Decimal(item.unit_price),
              discount_amount: new Prisma.Decimal(item.discount_amount || 0),
              tax_amount: new Prisma.Decimal(item.tax_amount || 0),
              total_amount: new Prisma.Decimal(item_total),
            };
          }),
        },
        ...(dto.taxes &&
          dto.taxes.length > 0 && {
            invoice_taxes: {
              create: dto.taxes.map((tax_item) => ({
                tax_rate_id: tax_item.tax_rate_id,
                tax_name: tax_item.tax_name,
                tax_rate: new Prisma.Decimal(tax_item.tax_rate),
                taxable_amount: new Prisma.Decimal(tax_item.taxable_amount),
                tax_amount: new Prisma.Decimal(tax_item.tax_amount),
                tax_type: (tax_item.tax_type ?? 'iva') as any,
              })),
            },
          }),
      },
      include: INVOICE_INCLUDE,
    });

    this.event_emitter.emit('invoice.created', {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      invoice_type: invoice.invoice_type,
    });

    this.logger.log(
      `Invoice ${invoice.invoice_number} created (ID: ${invoice.id})`,
    );
    return invoice;
  }

  async createFromOrder(order_id: number) {
    const context = this.getContext();
    await this.assertInvoicingAreaActive(context);
    const accounting_entity_id =
      await this.resolveAccountingEntityIdForContext(context);

    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      include: {
        order_items: {
          include: {
            products: true,
            product_variants: true,
            order_item_taxes: true,
          },
        },
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            document_number: true,
          },
        },
        invoice_data_requests: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_003);
    }

    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber({
        document_type: 'sales_invoice',
        accounting_entity_id,
      });

    const productItems = (order.order_items || []).map((item: any) => {
      const description =
        item.description ||
        item.product_name ||
        item.products?.name ||
        'Product';
      const quantity = Number(item.quantity || 1);
      const unit_price = Number(item.unit_price || 0);
      const discount = Number(item.discount_amount || 0);
      const tax = Number(item.tax_amount_item || 0) * quantity;
      const total_amount =
        Number(item.total_price || quantity * unit_price - discount) + tax;
      return {
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        description,
        quantity: new Prisma.Decimal(quantity),
        unit_price: new Prisma.Decimal(unit_price),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        total_amount: new Prisma.Decimal(total_amount),
        // "Empaque por tarifa" snapshot propagated from the order line so the
        // invoice mirrors the order PDF (tier label + packaging units consumed).
        applied_price_tier_name:
          item.applied_price_tier_name_snapshot ?? null,
        stock_units_consumed:
          typeof item.stock_units_consumed === 'number'
            ? item.stock_units_consumed
            : null,
        // Serial number(s) snapshot (CSV) copied from the order line so the
        // invoice carries the same serials at emission time (QUI-431).
        serial_numbers_snapshot: item.serial_numbers_snapshot ?? null,
      };
    });
    const shippingCost = Number(order.shipping_cost || 0);
    const items =
      shippingCost > 0
        ? [
            ...productItems,
            {
              product_id: null,
              product_variant_id: null,
              description: 'Envio',
              quantity: new Prisma.Decimal(1),
              unit_price: new Prisma.Decimal(shippingCost),
              discount_amount: new Prisma.Decimal(0),
              tax_amount: new Prisma.Decimal(0),
              total_amount: new Prisma.Decimal(shippingCost),
              applied_price_tier_name: null,
              stock_units_consumed: null,
              serial_numbers_snapshot: null,
            },
          ]
        : productItems;

    const subtotal = items.reduce(
      (acc: number, item: any) =>
        acc + Number(item.quantity) * Number(item.unit_price),
      0,
    );
    const discount = items.reduce(
      (acc: number, item: any) => acc + Number(item.discount_amount),
      0,
    );
    const tax = items.reduce(
      (acc: number, item: any) => acc + Number(item.tax_amount),
      0,
    );
    const total = subtotal - discount + tax;

    // Aggregate the order's per-line typed taxes (order_item_taxes) into invoice
    // header-level invoice_taxes, one row per (name, rate, fiscal type). Without
    // this, invoices created from an order reached DIAN with NO taxes and fell
    // back to a default 19% IVA. order_item_taxes.tax_rate is a fraction (0.19);
    // invoice_taxes.tax_rate is a percentage (19.00) as DIAN UBL expects.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const taxGroups = new Map<
      string,
      {
        tax_rate_id: number | null;
        tax_name: string;
        tax_rate: number;
        tax_type: string;
        taxable_amount: number;
        tax_amount: number;
      }
    >();
    for (const item of order.order_items || []) {
      const lineNet = Number(item.total_price || 0);
      for (const t of (item as any).order_item_taxes || []) {
        const ratePct = round2(Number(t.tax_rate || 0) * 100);
        const type = (t.tax_type as string) || 'iva';
        const key = `${t.tax_name}|${ratePct}|${type}|${t.tax_rate_id ?? ''}`;
        const group = taxGroups.get(key) || {
          tax_rate_id: t.tax_rate_id ?? null,
          tax_name: t.tax_name,
          tax_rate: ratePct,
          tax_type: type,
          taxable_amount: 0,
          tax_amount: 0,
        };
        group.taxable_amount += lineNet;
        group.tax_amount += Number(t.tax_amount || 0);
        taxGroups.set(key, group);
      }
    }
    const invoiceTaxes = Array.from(taxGroups.values()).map((g) => ({
      tax_rate_id: g.tax_rate_id,
      tax_name: g.tax_name,
      tax_rate: new Prisma.Decimal(g.tax_rate),
      taxable_amount: new Prisma.Decimal(round2(g.taxable_amount)),
      tax_amount: new Prisma.Decimal(round2(g.tax_amount)),
      tax_type: g.tax_type as any,
    }));

    const invoiceDataRequest = order.invoice_data_requests?.[0];
    const guest_customer_name = invoiceDataRequest
      ? `${invoiceDataRequest.first_name || ''} ${invoiceDataRequest.last_name || ''}`.trim()
      : '';
    const customer_name = order.users
      ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim()
      : guest_customer_name || 'Consumidor Final';

    const invoice = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id,
        fiscal_document_type: 'sales_invoice',
        invoice_number,
        invoice_type: 'sales_invoice',
        status: 'draft',
        customer_id: order.customer_id,
        customer_name,
        customer_tax_id:
          order.users?.document_number ||
          invoiceDataRequest?.document_number ||
          undefined,
        order_id: order.id,
        resolution_id,
        subtotal_amount: new Prisma.Decimal(subtotal),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        total_amount: new Prisma.Decimal(total),
        currency: 'COP',
        issue_date: new Date(),
        created_by_user_id: context.user_id,
        invoice_items: {
          create: items,
        },
        ...(invoiceTaxes.length > 0
          ? { invoice_taxes: { create: invoiceTaxes } }
          : {}),
      },
      include: INVOICE_INCLUDE,
    });

    this.event_emitter.emit('invoice.created', {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      invoice_type: 'sales_invoice',
      source: 'order',
      order_id,
    });

    this.logger.log(
      `Invoice ${invoice.invoice_number} created from order #${order_id}`,
    );
    return invoice;
  }

  async createFromSalesOrder(sales_order_id: number) {
    const context = this.getContext();
    await this.assertInvoicingAreaActive(context);
    const accounting_entity_id =
      await this.resolveAccountingEntityIdForContext(context);

    const sales_order = await this.prisma.sales_orders.findFirst({
      where: { id: sales_order_id },
      include: {
        sales_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });

    if (!sales_order) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_004);
    }

    // Fetch customer info separately
    const customer = await this.prisma.users.findFirst({
      where: { id: sales_order.customer_id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        document_number: true,
      },
    });

    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber({
        document_type: 'sales_invoice',
        accounting_entity_id,
      });

    const items = (sales_order.sales_order_items || []).map((item: any) => {
      const description =
        item.products?.name || item.product_variants?.name || 'Product';
      const quantity = Number(item.quantity || 1);
      const unit_price = Number(item.unit_price || 0);
      const discount = Number(item.discount || 0);
      const tax = 0; // sales_order_items don't have tax_amount
      const total_amount = quantity * unit_price - discount + tax;
      return {
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        description,
        quantity: new Prisma.Decimal(quantity),
        unit_price: new Prisma.Decimal(unit_price),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        total_amount: new Prisma.Decimal(total_amount),
      };
    });

    const subtotal = items.reduce(
      (acc: number, item: any) =>
        acc + Number(item.quantity) * Number(item.unit_price),
      0,
    );
    const discount = items.reduce(
      (acc: number, item: any) => acc + Number(item.discount_amount),
      0,
    );
    const tax = items.reduce(
      (acc: number, item: any) => acc + Number(item.tax_amount),
      0,
    );
    const total = subtotal - discount + tax;

    const customer_name = customer
      ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
      : undefined;

    const invoice = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id,
        fiscal_document_type: 'sales_invoice',
        invoice_number,
        invoice_type: 'sales_invoice',
        status: 'draft',
        customer_id: sales_order.customer_id,
        customer_name,
        customer_tax_id: customer?.document_number || undefined,
        sales_order_id: sales_order.id,
        resolution_id,
        subtotal_amount: new Prisma.Decimal(subtotal),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        total_amount: new Prisma.Decimal(total),
        currency: 'COP',
        issue_date: new Date(),
        created_by_user_id: context.user_id,
        invoice_items: {
          create: items,
        },
      },
      include: INVOICE_INCLUDE,
    });

    this.event_emitter.emit('invoice.created', {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      invoice_type: 'sales_invoice',
      source: 'sales_order',
      sales_order_id,
    });

    this.logger.log(
      `Invoice ${invoice.invoice_number} created from sales order #${sales_order_id}`,
    );
    return invoice;
  }

  async update(id: number, dto: UpdateInvoiceDto) {
    const invoice = await this.findOne(id);

    // Only allow editing invoices in draft state
    if (invoice.status !== 'draft') {
      throw new VendixHttpException(ErrorCodes.INVOICING_STATUS_002);
    }

    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'update',
    );

    if (dto.issue_date) {
      await this.assertFiscalPeriodOpen(
        invoice.accounting_entity_id,
        new Date(dto.issue_date),
        'update',
      );
    }

    if (
      invoice.invoice_type === 'support_adjustment_note' &&
      dto.related_invoice_id !== undefined
    ) {
      await this.findAcceptedSupportDocumentOriginal(
        dto.related_invoice_id,
        invoice.accounting_entity_id,
      );
    }

    // If items are provided, recalculate amounts and replace
    const update_data: any = {
      ...(dto.customer_id !== undefined && { customer_id: dto.customer_id }),
      ...(dto.supplier_id !== undefined && { supplier_id: dto.supplier_id }),
      ...(dto.customer_name !== undefined && {
        customer_name: dto.customer_name,
      }),
      ...(dto.customer_tax_id !== undefined && {
        customer_tax_id: dto.customer_tax_id,
      }),
      ...(dto.customer_address !== undefined && {
        customer_address: dto.customer_address,
      }),
      ...(dto.related_invoice_id !== undefined && {
        related_invoice_id: dto.related_invoice_id,
      }),
      ...(dto.withholding_amount !== undefined && {
        withholding_amount: new Prisma.Decimal(dto.withholding_amount),
      }),
      ...(dto.issue_date && { issue_date: new Date(dto.issue_date) }),
      ...(dto.due_date && { due_date: new Date(dto.due_date) }),
      ...(dto.currency && { currency: dto.currency }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };

    if (dto.items && dto.items.length > 0) {
      const { subtotal, discount, tax, total } = this.calculateAmounts(
        dto.items,
      );
      update_data.subtotal_amount = new Prisma.Decimal(subtotal);
      update_data.discount_amount = new Prisma.Decimal(discount);
      update_data.tax_amount = new Prisma.Decimal(tax);
      update_data.total_amount = new Prisma.Decimal(total);

      // Delete existing items and create new ones
      await this.prisma.invoice_items.deleteMany({
        where: { invoice_id: id },
      });

      update_data.invoice_items = {
        create: dto.items.map((item) => {
          const item_total =
            item.quantity * item.unit_price -
            (item.discount_amount || 0) +
            (item.tax_amount || 0);
          return {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity),
            unit_price: new Prisma.Decimal(item.unit_price),
            discount_amount: new Prisma.Decimal(item.discount_amount || 0),
            tax_amount: new Prisma.Decimal(item.tax_amount || 0),
            total_amount: new Prisma.Decimal(item_total),
          };
        }),
      };
    }

    if (dto.taxes) {
      await this.prisma.invoice_taxes.deleteMany({
        where: { invoice_id: id },
      });

      if (dto.taxes.length > 0) {
        update_data.invoice_taxes = {
          create: dto.taxes.map((tax_item) => ({
            tax_rate_id: tax_item.tax_rate_id,
            tax_name: tax_item.tax_name,
            tax_rate: new Prisma.Decimal(tax_item.tax_rate),
            taxable_amount: new Prisma.Decimal(tax_item.taxable_amount),
            tax_amount: new Prisma.Decimal(tax_item.tax_amount),
          })),
        };
      }
    }

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: update_data,
      include: INVOICE_INCLUDE,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) updated`);
    return updated;
  }

  async remove(id: number) {
    const invoice = await this.findOne(id);

    // Only allow deleting invoices in draft state
    if (invoice.status !== 'draft') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_002,
        'Only draft invoices can be deleted',
      );
    }

    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'delete',
    );

    await this.prisma.invoices.delete({
      where: { id },
    });

    this.logger.log(`Invoice #${id} (${invoice.invoice_number}) deleted`);
  }

  async getStats(date_from?: string, date_to?: string) {
    const where: Prisma.invoicesWhereInput = {
      // Exclude credit/debit notes from main stats
      invoice_type: {
        in: ['sales_invoice', 'purchase_invoice', 'export_invoice'],
      },
      ...(date_from && {
        issue_date: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    const [countsByStatus, totalAmount, pendingAmount] = await Promise.all([
      this.prisma.invoices.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
        _sum: { total_amount: true },
      }),
      this.prisma.invoices.aggregate({
        where: {
          ...where,
          status: { in: ['accepted'] },
        },
        _sum: { total_amount: true },
        _count: { id: true },
      }),
      this.prisma.invoices.aggregate({
        where: {
          ...where,
          status: { in: ['draft', 'validated', 'sent'] },
        },
        _sum: { total_amount: true },
        _count: { id: true },
      }),
    ]);

    const counts_by_status: Record<string, { count: number; amount: number }> =
      {
        draft: { count: 0, amount: 0 },
        validated: { count: 0, amount: 0 },
        sent: { count: 0, amount: 0 },
        accepted: { count: 0, amount: 0 },
        rejected: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
        voided: { count: 0, amount: 0 },
      };

    for (const row of countsByStatus) {
      if (row.status) {
        counts_by_status[row.status] = {
          count: row._count.id,
          amount: Number(row._sum.total_amount || 0),
        };
      }
    }

    return {
      total_accepted_amount: Number(totalAmount._sum.total_amount || 0),
      total_accepted_count: totalAmount._count.id,
      total_pending_amount: Number(pendingAmount._sum.total_amount || 0),
      total_pending_count: pendingAmount._count.id,
      counts_by_status,
    };
  }

  private calculateAmounts(
    items: {
      quantity: number;
      unit_price: number;
      discount_amount?: number;
      tax_amount?: number;
    }[],
  ) {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;

    for (const item of items) {
      subtotal += item.quantity * item.unit_price;
      discount += item.discount_amount || 0;
      tax += item.tax_amount || 0;
    }

    const total = subtotal - discount + tax;

    return { subtotal, discount, tax, total };
  }
}
