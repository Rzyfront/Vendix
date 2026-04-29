import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { InvoiceNumberGenerator } from './utils/invoice-number-generator';

const INVOICE_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: true,
  customer: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
  supplier: {
    select: { id: true, name: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  related_invoice: {
    select: { id: true, invoice_number: true, invoice_type: true },
  },
};

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly invoice_number_generator: InvoiceNumberGenerator,
    private readonly event_emitter: EventEmitter2,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
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

    return {
      data,
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

    // Generate invoice number from resolution
    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber(dto.resolution_id);

    // Calculate amounts from items
    const { subtotal, discount, tax, total } = this.calculateAmounts(dto.items);

    const invoice = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        invoice_number,
        invoice_type: dto.invoice_type,
        status: 'draft',
        customer_id: dto.customer_id,
        supplier_id: dto.supplier_id,
        customer_name: dto.customer_name,
        customer_tax_id: dto.customer_tax_id,
        customer_address: dto.customer_address,
        resolution_id,
        subtotal_amount: new Prisma.Decimal(subtotal),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        total_amount: new Prisma.Decimal(total),
        currency: dto.currency || 'COP',
        issue_date: new Date(dto.issue_date),
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

    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      include: {
        order_items: {
          include: {
            products: true,
            product_variants: true,
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
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_003);
    }

    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber();

    const items = (order.order_items || []).map((item: any) => {
      const description = item.product_name || item.products?.name || 'Product';
      const quantity = Number(item.quantity || 1);
      const unit_price = Number(item.unit_price || 0);
      const discount = Number(item.discount_amount || 0);
      const tax = Number(item.tax_amount_item || 0);
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

    const customer_name = order.users
      ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim()
      : undefined;

    const invoice = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        invoice_number,
        invoice_type: 'sales_invoice',
        status: 'draft',
        customer_id: order.customer_id,
        customer_name,
        customer_tax_id: order.users?.document_number || undefined,
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
      await this.invoice_number_generator.generateNextNumber();

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
