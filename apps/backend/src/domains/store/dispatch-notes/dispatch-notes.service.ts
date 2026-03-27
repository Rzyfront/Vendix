import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateDispatchNoteDto,
  UpdateDispatchNoteDto,
  DispatchNoteQueryDto,
  CreateFromSalesOrderDto,
} from './dto';
import { dispatch_note_status_enum, Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { DispatchNumberGenerator } from './utils/dispatch-number-generator';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

const DISPATCH_NOTE_INCLUDE = {
  dispatch_note_items: {
    include: {
      product: true,
      product_variant: true,
      location: true,
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
  sales_order: {
    select: {
      id: true,
      order_number: true,
      status: true,
    },
  },
  invoice: {
    select: {
      id: true,
      invoice_number: true,
      status: true,
    },
  },
  dispatch_location: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  confirmed_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  delivered_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  voided_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

@Injectable()
export class DispatchNotesService {
  private readonly logger = new Logger(DispatchNotesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly dispatchNumberGenerator: DispatchNumberGenerator,
  ) {}

  async create(dto: CreateDispatchNoteDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // Denormalize customer data
    const customer = await this.prisma.users.findUnique({
      where: { id: dto.customer_id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        document_number: true,
      },
    });

    if (!customer) {
      throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
    }

    const customer_name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim();

    // Calculate totals from items
    const items: any[] = dto.items || [];
    const subtotal = items.reduce(
      (sum, item) => sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    let retries = 3;
    while (retries > 0) {
      try {
        const dispatch_number =
          await this.dispatchNumberGenerator.generateNextNumber(store_id);

        const dispatch_note = await this.prisma.dispatch_notes.create({
          data: {
            store_id,
            dispatch_number,
            status: dispatch_note_status_enum.draft,
            customer_id: dto.customer_id,
            customer_name,
            customer_tax_id: customer.document_number || null,
            sales_order_id: dto.sales_order_id,
            dispatch_location_id: dto.dispatch_location_id,
            emission_date: dto.emission_date
              ? new Date(dto.emission_date)
              : new Date(),
            agreed_delivery_date: dto.agreed_delivery_date
              ? new Date(dto.agreed_delivery_date)
              : null,
            subtotal_amount: subtotal,
            discount_amount: total_discount,
            tax_amount: total_tax,
            grand_total,
            currency: dto.currency || 'COP',
            notes: dto.notes,
            internal_notes: dto.internal_notes,
            created_by_user_id: context?.user_id,
            updated_at: new Date(),
            dispatch_note_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                location_id: item.location_id,
                ordered_quantity: item.ordered_quantity,
                dispatched_quantity: item.dispatched_quantity,
                unit_price: item.unit_price,
                discount_amount: item.discount_amount || 0,
                tax_amount: item.tax_amount || 0,
                total_price:
                  (Number(item.unit_price || 0) * item.dispatched_quantity) -
                  Number(item.discount_amount || 0) +
                  Number(item.tax_amount || 0),
                lot_serial: item.lot_serial,
                sales_order_item_id: item.sales_order_item_id,
              })),
            },
          },
          include: DISPATCH_NOTE_INCLUDE,
        });

        return dispatch_note;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[];
          if (Array.isArray(target) && target.includes('dispatch_number')) {
            retries--;
            if (retries === 0) {
              throw new ConflictException(
                'No se pudo generar un número de remisión único después de varios intentos',
              );
            }
            continue;
          }
        }
        throw error;
      }
    }
  }

  async createFromSalesOrder(
    sales_order_id: number,
    dto: CreateFromSalesOrderDto,
  ) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // Fetch the sales order with items
    const sales_order = await this.prisma.sales_orders.findFirst({
      where: { id: sales_order_id },
      include: {
        sales_order_items: {
          include: {
            product: { select: { id: true, name: true } },
            product_variant: { select: { id: true, sku: true } },
          },
        },
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            document_number: true,
          },
        },
      },
    });

    if (!sales_order) {
      throw new NotFoundException('Orden de venta no encontrada');
    }

    const customer_name = `${sales_order.customer?.first_name || ''} ${sales_order.customer?.last_name || ''}`.trim();

    // Build items from sales order items
    const items_map = new Map(
      dto.items.map((i) => [i.sales_order_item_id, i]),
    );

    const dispatch_items: any[] = [];
    for (const dto_item of dto.items) {
      const so_item = sales_order.sales_order_items.find(
        (si: any) => si.id === dto_item.sales_order_item_id,
      );

      if (!so_item) {
        throw new BadRequestException(
          `Item de orden de venta #${dto_item.sales_order_item_id} no encontrado`,
        );
      }

      dispatch_items.push({
        product_id: so_item.product_id,
        product_variant_id: so_item.product_variant_id,
        location_id: dto_item.location_id,
        ordered_quantity: so_item.quantity,
        dispatched_quantity: dto_item.dispatched_quantity,
        unit_price: so_item.unit_price,
        discount_amount: so_item.discount_amount || 0,
        tax_amount: so_item.tax_amount || 0,
        total_price:
          (Number(so_item.unit_price || 0) * dto_item.dispatched_quantity) -
          Number(so_item.discount_amount || 0) +
          Number(so_item.tax_amount || 0),
        lot_serial: dto_item.lot_serial,
        sales_order_item_id: dto_item.sales_order_item_id,
      });
    }

    const subtotal = dispatch_items.reduce(
      (sum, item) => sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = dispatch_items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = dispatch_items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    const dispatch_number =
      await this.dispatchNumberGenerator.generateNextNumber(store_id);

    const dispatch_note = await this.prisma.dispatch_notes.create({
      data: {
        store_id,
        dispatch_number,
        status: dispatch_note_status_enum.draft,
        customer_id: sales_order.customer_id,
        customer_name,
        customer_tax_id: sales_order.customer?.document_number || null,
        sales_order_id,
        dispatch_location_id: dto.dispatch_location_id,
        emission_date: new Date(),
        agreed_delivery_date: dto.agreed_delivery_date
          ? new Date(dto.agreed_delivery_date)
          : null,
        subtotal_amount: subtotal,
        discount_amount: total_discount,
        tax_amount: total_tax,
        grand_total,
        currency: sales_order.currency || 'COP',
        notes: dto.notes,
        created_by_user_id: context?.user_id,
        updated_at: new Date(),
        dispatch_note_items: {
          create: dispatch_items,
        },
      },
      include: DISPATCH_NOTE_INCLUDE,
    });

    return dispatch_note;
  }

  async findAll(query: DispatchNoteQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      customer_id,
      sales_order_id,
      date_from,
      date_to,
      sort_by,
      sort_order,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.dispatch_notesWhereInput = {
      ...(search && {
        OR: [
          { dispatch_number: { contains: search, mode: 'insensitive' as any } },
          { customer_name: { contains: search, mode: 'insensitive' as any } },
        ],
      }),
      ...(status && { status }),
      ...(customer_id && { customer_id }),
      ...(sales_order_id && { sales_order_id }),
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
      this.prisma.dispatch_notes.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          dispatch_note_items: {
            select: {
              id: true,
              product_id: true,
              dispatched_quantity: true,
            },
          },
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.dispatch_notes.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const dispatch_note = await this.prisma.dispatch_notes.findFirst({
      where: { id },
      include: DISPATCH_NOTE_INCLUDE,
    });

    if (!dispatch_note) {
      throw new NotFoundException('Remisión no encontrada');
    }

    return dispatch_note;
  }

  async update(id: number, dto: UpdateDispatchNoteDto) {
    const dispatch_note = await this.findOne(id);

    if (dispatch_note.status !== dispatch_note_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden editar remisiones en estado borrador',
      );
    }

    // If items are provided, delete and recreate
    if (dto.items) {
      return this.prisma.$transaction(async (tx) => {
        await tx.dispatch_note_items.deleteMany({
          where: { dispatch_note_id: id },
        });

        const items = dto.items!;
        const subtotal = items.reduce(
          (sum, item) =>
            sum + Number(item.unit_price || 0) * item.dispatched_quantity,
          0,
        );
        const total_discount = items.reduce(
          (sum, item) => sum + Number(item.discount_amount || 0),
          0,
        );
        const total_tax = items.reduce(
          (sum, item) => sum + Number(item.tax_amount || 0),
          0,
        );
        const grand_total = subtotal - total_discount + total_tax;

        // Denormalize customer if changed
        let customer_data: any = {};
        if (dto.customer_id && dto.customer_id !== dispatch_note.customer_id) {
          const customer = await tx.users.findUnique({
            where: { id: dto.customer_id },
            select: { first_name: true, last_name: true, document_number: true },
          });
          if (customer) {
            customer_data = {
              customer_name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
              customer_tax_id: customer.document_number || null,
            };
          }
        }

        return tx.dispatch_notes.update({
          where: { id },
          data: {
            customer_id: dto.customer_id ?? dispatch_note.customer_id,
            sales_order_id: dto.sales_order_id ?? dispatch_note.sales_order_id,
            dispatch_location_id:
              dto.dispatch_location_id ?? dispatch_note.dispatch_location_id,
            emission_date: dto.emission_date
              ? new Date(dto.emission_date)
              : dispatch_note.emission_date,
            agreed_delivery_date: dto.agreed_delivery_date
              ? new Date(dto.agreed_delivery_date)
              : dispatch_note.agreed_delivery_date,
            notes: dto.notes ?? dispatch_note.notes,
            internal_notes: dto.internal_notes ?? dispatch_note.internal_notes,
            currency: dto.currency ?? dispatch_note.currency,
            subtotal_amount: subtotal,
            discount_amount: total_discount,
            tax_amount: total_tax,
            grand_total,
            ...customer_data,
            updated_at: new Date(),
            dispatch_note_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                location_id: item.location_id,
                ordered_quantity: item.ordered_quantity,
                dispatched_quantity: item.dispatched_quantity,
                unit_price: item.unit_price,
                discount_amount: item.discount_amount || 0,
                tax_amount: item.tax_amount || 0,
                total_price:
                  (Number(item.unit_price || 0) * item.dispatched_quantity) -
                  Number(item.discount_amount || 0) +
                  Number(item.tax_amount || 0),
                lot_serial: item.lot_serial,
                sales_order_item_id: item.sales_order_item_id,
              })),
            },
          },
          include: DISPATCH_NOTE_INCLUDE,
        });
      });
    }

    // Update without items
    const { items: _items, ...update_data } = dto as any;

    // Denormalize customer if changed
    let customer_data: any = {};
    if (dto.customer_id && dto.customer_id !== dispatch_note.customer_id) {
      const customer = await this.prisma.users.findUnique({
        where: { id: dto.customer_id },
        select: { first_name: true, last_name: true, document_number: true },
      });
      if (customer) {
        customer_data = {
          customer_name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
          customer_tax_id: customer.document_number || null,
        };
      }
    }

    return this.prisma.dispatch_notes.update({
      where: { id },
      data: {
        ...update_data,
        ...customer_data,
        emission_date: update_data.emission_date
          ? new Date(update_data.emission_date)
          : undefined,
        agreed_delivery_date: update_data.agreed_delivery_date
          ? new Date(update_data.agreed_delivery_date)
          : undefined,
        updated_at: new Date(),
      },
      include: DISPATCH_NOTE_INCLUDE,
    });
  }

  async remove(id: number) {
    const dispatch_note = await this.findOne(id);

    if (dispatch_note.status !== dispatch_note_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden eliminar remisiones en estado borrador',
      );
    }

    return this.prisma.dispatch_notes.delete({ where: { id } });
  }

  async getStats() {
    const [total, draft, confirmed, delivered, invoiced, voided, total_value] =
      await Promise.all([
        this.prisma.dispatch_notes.count(),
        this.prisma.dispatch_notes.count({ where: { status: 'draft' } }),
        this.prisma.dispatch_notes.count({ where: { status: 'confirmed' } }),
        this.prisma.dispatch_notes.count({ where: { status: 'delivered' } }),
        this.prisma.dispatch_notes.count({ where: { status: 'invoiced' } }),
        this.prisma.dispatch_notes.count({ where: { status: 'voided' } }),
        this.prisma.dispatch_notes.aggregate({
          _sum: { grand_total: true },
          where: { status: { not: 'voided' } },
        }),
      ]);

    const pending_invoicing = delivered;
    const average_value =
      total > 0 ? Number(total_value._sum.grand_total || 0) / total : 0;

    return {
      total,
      draft,
      confirmed,
      delivered,
      invoiced,
      voided,
      pending_invoicing,
      average_value: Math.round(average_value * 100) / 100,
    };
  }

  async getBySalesOrder(sales_order_id: number) {
    const dispatch_notes = await this.prisma.dispatch_notes.findMany({
      where: { sales_order_id },
      orderBy: { created_at: 'desc' },
      include: {
        dispatch_note_items: {
          select: {
            id: true,
            product_id: true,
            dispatched_quantity: true,
            sales_order_item_id: true,
          },
        },
      },
    });

    return dispatch_notes;
  }

  async getPendingInvoicing(query: DispatchNoteQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const where: any = {
      store_id,
      status: 'delivered',
    };

    if (query.customer_id) where.customer_id = Number(query.customer_id);
    if (query.date_from) where.emission_date = { ...(where.emission_date || {}), gte: new Date(query.date_from) };
    if (query.date_to) where.emission_date = { ...(where.emission_date || {}), lte: new Date(query.date_to) };

    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);

    const [data, total] = await Promise.all([
      this.prisma.dispatch_notes.findMany({
        where,
        include: {
          customer: { select: { id: true, first_name: true, last_name: true } },
          dispatch_note_items: true,
        },
        orderBy: { emission_date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatch_notes.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getByCustomerReport(query: DispatchNoteQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const where: any = { store_id };

    if (query.customer_id) where.customer_id = Number(query.customer_id);
    if (query.status) where.status = query.status;
    if (query.date_from) where.emission_date = { ...(where.emission_date || {}), gte: new Date(query.date_from) };
    if (query.date_to) where.emission_date = { ...(where.emission_date || {}), lte: new Date(query.date_to) };
    if (query.search) {
      where.OR = [
        { dispatch_number: { contains: query.search, mode: 'insensitive' } },
        { customer_name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);

    const [data, total] = await Promise.all([
      this.prisma.dispatch_notes.findMany({
        where,
        include: {
          customer: { select: { id: true, first_name: true, last_name: true } },
          dispatch_note_items: {
            include: { product: { select: { id: true, name: true, sku: true } } },
          },
        },
        orderBy: { emission_date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatch_notes.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getProfitabilityReport(query: DispatchNoteQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const where: any = {
      store_id,
      status: { in: ['delivered', 'invoiced'] },
    };

    if (query.customer_id) where.customer_id = Number(query.customer_id);
    if (query.date_from) where.emission_date = { ...(where.emission_date || {}), gte: new Date(query.date_from) };
    if (query.date_to) where.emission_date = { ...(where.emission_date || {}), lte: new Date(query.date_to) };

    const dispatch_notes = await this.prisma.dispatch_notes.findMany({
      where,
      include: {
        dispatch_note_items: true,
        invoice: {
          select: { id: true, invoice_number: true, total_amount: true, status: true },
        },
      },
      orderBy: { emission_date: 'desc' },
    });

    const summary = {
      total_dispatched: dispatch_notes.reduce((sum, dn) => sum + Number(dn.grand_total), 0),
      total_invoiced: dispatch_notes
        .filter((dn) => dn.invoice)
        .reduce((sum, dn) => sum + Number(dn.invoice?.total_amount || 0), 0),
      gap: 0,
      dispatch_notes_count: dispatch_notes.length,
      invoiced_count: dispatch_notes.filter((dn) => dn.status === 'invoiced').length,
      pending_count: dispatch_notes.filter((dn) => dn.status === 'delivered').length,
    };
    summary.gap = summary.total_dispatched - summary.total_invoiced;

    return { summary, dispatch_notes };
  }
}
