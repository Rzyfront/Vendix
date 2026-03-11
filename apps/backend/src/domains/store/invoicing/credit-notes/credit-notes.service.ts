import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateCreditNoteDto, CreateDebitNoteDto } from './dto/create-credit-note.dto';
import { InvoiceNumberGenerator } from '../utils/invoice-number-generator';

const INVOICE_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: true,
  related_invoice: {
    select: { id: true, invoice_number: true, invoice_type: true },
  },
  customer: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

@Injectable()
export class CreditNotesService {
  private readonly logger = new Logger(CreditNotesService.name);

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

  async createCreditNote(dto: CreateCreditNoteDto) {
    return this.createNote(dto, 'credit_note');
  }

  async createDebitNote(dto: CreateDebitNoteDto) {
    return this.createNote(dto, 'debit_note');
  }

  private async createNote(
    dto: CreateCreditNoteDto | CreateDebitNoteDto,
    type: 'credit_note' | 'debit_note',
  ) {
    const context = this.getContext();

    // Validate the related invoice exists and is accepted
    const related_invoice = await this.prisma.invoices.findFirst({
      where: { id: dto.related_invoice_id },
    });

    if (!related_invoice) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    }

    if (related_invoice.status !== 'accepted' && related_invoice.status !== 'sent') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_002,
        `Cannot create ${type} for invoice in '${related_invoice.status}' status. Invoice must be accepted or sent.`,
      );
    }

    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber();

    // Calculate amounts
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    for (const item of dto.items) {
      subtotal += item.quantity * item.unit_price;
      discount += item.discount_amount || 0;
      tax += item.tax_amount || 0;
    }
    const total = subtotal - discount + tax;

    const note = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        invoice_number,
        invoice_type: type,
        status: 'draft',
        customer_id: related_invoice.customer_id,
        customer_name: related_invoice.customer_name,
        customer_tax_id: related_invoice.customer_tax_id,
        customer_address: related_invoice.customer_address,
        related_invoice_id: related_invoice.id,
        resolution_id,
        subtotal_amount: new Prisma.Decimal(subtotal),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        total_amount: new Prisma.Decimal(total),
        currency: dto.currency || related_invoice.currency || 'COP',
        issue_date: new Date(dto.issue_date),
        created_by_user_id: context.user_id,
        notes: dto.notes || (dto as CreateCreditNoteDto).reason,
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
      invoice_id: note.id,
      invoice_number: note.invoice_number,
      invoice_type: type,
      related_invoice_id: related_invoice.id,
    });

    this.logger.log(
      `${type === 'credit_note' ? 'Credit' : 'Debit'} note ${note.invoice_number} created for invoice #${related_invoice.id}`,
    );
    return note;
  }
}
