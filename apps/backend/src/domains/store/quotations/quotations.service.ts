import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateQuotationDto,
  UpdateQuotationDto,
  QuotationQueryDto,
} from './dto';
import { quotation_status_enum, Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from '../orders/orders.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { EmailService } from '../../../email/email.service';
import { generateQuotationEmailHtml } from '../../../email/templates/quotation-email.template';

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly ordersService: OrdersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
  ) {}

  // VALID_TRANSITIONS state machine
  private readonly VALID_TRANSITIONS: Record<string, string[]> = {
    draft: ['sent', 'cancelled'],
    sent: ['accepted', 'rejected', 'expired', 'cancelled'],
    accepted: ['converted', 'cancelled'],
    rejected: [],
    expired: [],
    converted: [],
    cancelled: [],
  };

  private readonly QUOTATION_INCLUDE = {
    quotation_items: {
      include: {
        product: true,
        product_variant: true,
      },
    },
    customer: {
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
      },
    },
    created_by_user: {
      select: {
        id: true,
        first_name: true,
        last_name: true,
      },
    },
    converted_order: {
      select: {
        id: true,
        order_number: true,
        state: true,
        grand_total: true,
      },
    },
  };

  async create(createQuotationDto: CreateQuotationDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const quotation_number = await this.generateQuotationNumber(store_id);

    // Calculate totals from items
    const items = createQuotationDto.items || [];
    const subtotal = items.reduce(
      (sum, item) => sum + Number(item.total_price),
      0,
    );
    const totalDiscount = items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const totalTax = items.reduce(
      (sum, item) => sum + Number(item.tax_amount_item || 0),
      0,
    );
    const grand_total = subtotal - totalDiscount + totalTax;

    const quotation = await this.prisma.quotations.create({
      data: {
        store_id,
        customer_id: createQuotationDto.customer_id,
        quotation_number,
        status: quotation_status_enum.draft,
        channel: (createQuotationDto.channel as any) || 'pos',
        subtotal_amount: subtotal,
        discount_amount: totalDiscount,
        tax_amount: totalTax,
        grand_total,
        valid_until: createQuotationDto.valid_until
          ? new Date(createQuotationDto.valid_until)
          : null,
        notes: createQuotationDto.notes,
        internal_notes: createQuotationDto.internal_notes,
        terms_and_conditions: createQuotationDto.terms_and_conditions,
        created_by_user_id: context?.user_id,
        updated_at: new Date(),
        quotation_items: {
          create: items.map((item) => ({
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            product_name: item.product_name,
            variant_sku: item.variant_sku,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_amount: item.discount_amount || 0,
            tax_rate: item.tax_rate,
            tax_amount_item: item.tax_amount_item,
            total_price: item.total_price,
            notes: item.notes,
            updated_at: new Date(),
          })),
        },
      },
      include: this.QUOTATION_INCLUDE,
    });

    this.eventEmitter.emit('quotation.created', {
      store_id,
      quotation_id: quotation.id,
      quotation_number: quotation.quotation_number,
    });

    return quotation;
  }

  async findAll(query: QuotationQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      customer_id,
      date_from,
      date_to,
      sort_by,
      sort_order,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.quotationsWhereInput = {
      ...(search && {
        OR: [
          {
            quotation_number: { contains: search, mode: 'insensitive' as any },
          },
          { notes: { contains: search, mode: 'insensitive' as any } },
        ],
      }),
      ...(status && { status: status as quotation_status_enum }),
      ...(customer_id && { customer_id }),
      ...(date_from &&
        date_to && {
          created_at: {
            gte: new Date(date_from),
            lte: new Date(date_to),
          },
        }),
    };

    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [data, total] = await Promise.all([
      this.prisma.quotations.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: this.QUOTATION_INCLUDE,
      }),
      this.prisma.quotations.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const quotation = await this.prisma.quotations.findFirst({
      where: { id },
      include: this.QUOTATION_INCLUDE,
    });
    if (!quotation) throw new NotFoundException('Cotización no encontrada');
    return quotation;
  }

  async update(id: number, updateQuotationDto: UpdateQuotationDto) {
    const quotation = await this.findOne(id);
    if (quotation.status !== quotation_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden editar cotizaciones en estado borrador',
      );
    }

    // If items are provided, delete and recreate
    if (updateQuotationDto.items) {
      return this.prisma.$transaction(async (tx) => {
        await tx.quotation_items.deleteMany({ where: { quotation_id: id } });

        const items = updateQuotationDto.items!;
        const subtotal = items.reduce(
          (sum, item) => sum + Number(item.total_price),
          0,
        );
        const totalDiscount = items.reduce(
          (sum, item) => sum + Number(item.discount_amount || 0),
          0,
        );
        const totalTax = items.reduce(
          (sum, item) => sum + Number(item.tax_amount_item || 0),
          0,
        );
        const grand_total = subtotal - totalDiscount + totalTax;

        return tx.quotations.update({
          where: { id },
          data: {
            customer_id:
              updateQuotationDto.customer_id ?? quotation.customer_id,
            channel: (updateQuotationDto.channel as any) ?? quotation.channel,
            valid_until: updateQuotationDto.valid_until
              ? new Date(updateQuotationDto.valid_until)
              : quotation.valid_until,
            notes: updateQuotationDto.notes ?? quotation.notes,
            internal_notes:
              updateQuotationDto.internal_notes ?? quotation.internal_notes,
            terms_and_conditions:
              updateQuotationDto.terms_and_conditions ??
              quotation.terms_and_conditions,
            subtotal_amount: subtotal,
            discount_amount: totalDiscount,
            tax_amount: totalTax,
            grand_total,
            updated_at: new Date(),
            quotation_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                product_name: item.product_name,
                variant_sku: item.variant_sku,
                quantity: item.quantity,
                unit_price: item.unit_price,
                discount_amount: item.discount_amount || 0,
                tax_rate: item.tax_rate,
                tax_amount_item: item.tax_amount_item,
                total_price: item.total_price,
                notes: item.notes,
                updated_at: new Date(),
              })),
            },
          },
          include: this.QUOTATION_INCLUDE,
        });
      });
    }

    // Update without items
    const { items: _items, ...updateData } = updateQuotationDto as any;
    return this.prisma.quotations.update({
      where: { id },
      data: {
        ...updateData,
        valid_until: updateData.valid_until
          ? new Date(updateData.valid_until)
          : undefined,
        updated_at: new Date(),
      },
      include: this.QUOTATION_INCLUDE,
    });
  }

  async remove(id: number) {
    const quotation = await this.findOne(id);
    if (quotation.status !== quotation_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden eliminar cotizaciones en estado borrador',
      );
    }
    return this.prisma.quotations.delete({ where: { id } });
  }

  // State transition methods
  async send(id: number) {
    const quotation = await this.transition(id, 'sent', {
      sent_at: new Date(),
    });

    // Send email if customer has email (fire-and-forget)
    if (quotation.customer?.email) {
      this.sendQuotationEmail(quotation).catch((err) => {
        // Log but don't throw - the status change already succeeded
        console.error(
          `Failed to send quotation email for ${quotation.quotation_number}:`,
          err,
        );
      });
    }

    return quotation;
  }

  async accept(id: number) {
    return this.transition(id, 'accepted', { accepted_at: new Date() });
  }

  async reject(id: number) {
    return this.transition(id, 'rejected', { rejected_at: new Date() });
  }

  async cancel(id: number) {
    const quotation = await this.findOne(id);
    const allowed = this.VALID_TRANSITIONS[quotation.status] || [];
    if (!allowed.includes('cancelled')) {
      throw new BadRequestException(
        `No se puede cancelar una cotización en estado "${quotation.status}"`,
      );
    }
    return this.prisma.quotations.update({
      where: { id },
      data: { status: quotation_status_enum.cancelled, updated_at: new Date() },
      include: this.QUOTATION_INCLUDE,
    });
  }

  async convertToOrder(id: number) {
    const quotation = await this.findOne(id);
    if (quotation.status !== quotation_status_enum.accepted) {
      throw new VendixHttpException(
        ErrorCodes.QUOTE_CONVERT_STATUS_001,
        undefined,
        {
          current_status: quotation.status,
          required_status: quotation_status_enum.accepted,
        },
      );
    }

    if (!quotation.customer_id) {
      throw new VendixHttpException(
        ErrorCodes.QUOTE_CONVERT_CUSTOMER_001,
        undefined,
        { quotation_id: quotation.id },
      );
    }

    const context = RequestContextService.getContext();

    // Map quotation items to order items format
    const orderItems = quotation.quotation_items.map((item: any) => ({
      product_id: item.product_id,
      product_variant_id: item.product_variant_id,
      product_name: item.product_name,
      variant_sku: item.variant_sku,
      quantity: item.quantity,
      unit_price: Number(item.unit_price),
      total_price: Number(item.total_price),
      tax_rate: item.tax_rate ? Number(item.tax_rate) : undefined,
      tax_amount_item: item.tax_amount_item
        ? Number(item.tax_amount_item)
        : undefined,
    }));

    // Create order using OrdersService
    const order = await this.ordersService.create(
      {
        customer_id: quotation.customer_id!,
        items: orderItems,
        subtotal: Number(quotation.subtotal_amount),
        tax_amount: Number(quotation.tax_amount),
        discount_amount: Number(quotation.discount_amount),
        total_amount: Number(quotation.grand_total),
        internal_notes: `Convertida desde cotización ${quotation.quotation_number}`,
        channel: quotation.channel,
      } as any,
      { id: context?.user_id },
    );

    // Update quotation status
    const updated = await this.prisma.quotations.update({
      where: { id },
      data: {
        status: quotation_status_enum.converted,
        converted_at: new Date(),
        converted_order_id: order.id,
        updated_at: new Date(),
      },
      include: this.QUOTATION_INCLUDE,
    });

    this.eventEmitter.emit('quotation.converted', {
      quotation_id: id,
      order_id: order.id,
      quotation_number: quotation.quotation_number,
      order_number: order.order_number,
    });

    return updated;
  }

  async duplicate(id: number) {
    const quotation = await this.findOne(id);
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const quotation_number = await this.generateQuotationNumber(store_id);

    const duplicated = await this.prisma.quotations.create({
      data: {
        store_id,
        customer_id: quotation.customer_id,
        quotation_number,
        status: quotation_status_enum.draft,
        channel: quotation.channel,
        subtotal_amount: quotation.subtotal_amount,
        discount_amount: quotation.discount_amount,
        tax_amount: quotation.tax_amount,
        grand_total: quotation.grand_total,
        notes: quotation.notes,
        internal_notes: quotation.internal_notes,
        terms_and_conditions: quotation.terms_and_conditions,
        created_by_user_id: context?.user_id,
        updated_at: new Date(),
        quotation_items: {
          create: quotation.quotation_items.map((item: any) => ({
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            product_name: item.product_name,
            variant_sku: item.variant_sku,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_amount: item.discount_amount,
            tax_rate: item.tax_rate,
            tax_amount_item: item.tax_amount_item,
            total_price: item.total_price,
            notes: item.notes,
            updated_at: new Date(),
          })),
        },
      },
      include: this.QUOTATION_INCLUDE,
    });

    return duplicated;
  }

  async getStats() {
    const [total, draft, sent, accepted, converted, totalValue] =
      await Promise.all([
        this.prisma.quotations.count(),
        this.prisma.quotations.count({ where: { status: 'draft' } }),
        this.prisma.quotations.count({ where: { status: 'sent' } }),
        this.prisma.quotations.count({ where: { status: 'accepted' } }),
        this.prisma.quotations.count({ where: { status: 'converted' } }),
        this.prisma.quotations.aggregate({ _sum: { grand_total: true } }),
      ]);

    const pending = draft + sent;
    const conversionRate =
      accepted + converted > 0 && total > 0
        ? ((accepted + converted) / total) * 100
        : 0;
    const averageValue =
      total > 0 ? Number(totalValue._sum.grand_total || 0) / total : 0;

    return {
      total,
      pending,
      conversion_rate: Math.round(conversionRate * 100) / 100,
      average_value: Math.round(averageValue * 100) / 100,
      draft,
      sent,
      accepted,
      converted,
    };
  }

  // Private helpers
  private async sendQuotationEmail(quotation: any): Promise<void> {
    const storeName = await this.getStoreName();
    const html = generateQuotationEmailHtml({
      quotation_number: quotation.quotation_number,
      customer_name: `${quotation.customer.first_name} ${quotation.customer.last_name}`,
      valid_until: quotation.valid_until
        ? new Date(quotation.valid_until).toLocaleDateString('es-CO', {
            timeZone: 'UTC',
          })
        : null,
      items: quotation.quotation_items.map((item: any) => ({
        product_name: item.product_name,
        variant_sku: item.variant_sku,
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
        total_price: Number(item.total_price),
      })),
      subtotal: Number(quotation.subtotal_amount),
      discount: Number(quotation.discount_amount),
      tax: Number(quotation.tax_amount),
      total: Number(quotation.grand_total),
      notes: quotation.notes,
      terms_and_conditions: quotation.terms_and_conditions,
      store_name: storeName,
    });

    await this.emailService.sendEmail(
      quotation.customer.email,
      `Cotización ${quotation.quotation_number} - ${storeName}`,
      html,
    );
  }

  private async getStoreName(): Promise<string> {
    try {
      const context = RequestContextService.getContext();
      if (context?.store_id) {
        const store = await this.prisma.stores.findFirst({
          where: { id: context.store_id },
          select: { name: true },
        });
        return store?.name || 'Vendix';
      }
    } catch {}
    return 'Vendix';
  }

  private async transition(
    id: number,
    newStatus: string,
    extraData: Record<string, any> = {},
  ) {
    const quotation = await this.findOne(id);
    const allowed = this.VALID_TRANSITIONS[quotation.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `No se puede cambiar de "${quotation.status}" a "${newStatus}"`,
      );
    }
    return this.prisma.quotations.update({
      where: { id },
      data: {
        status: newStatus as quotation_status_enum,
        ...extraData,
        updated_at: new Date(),
      },
      include: this.QUOTATION_INCLUDE,
    });
  }

  private async generateQuotationNumber(storeId: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const prefix = `QT-${year}${month}${day}-`;

    const lastQuotation = await this.prisma.quotations.findFirst({
      where: {
        store_id: storeId,
        quotation_number: { startsWith: prefix },
      },
      orderBy: { quotation_number: 'desc' },
    });

    let sequence = 1;
    if (lastQuotation) {
      const lastSequence = parseInt(lastQuotation.quotation_number.slice(-4));
      sequence = lastSequence + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }
}
