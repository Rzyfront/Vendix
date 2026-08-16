import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import {
  CreateCreditNoteDto,
  CreateDebitNoteDto,
} from './dto/create-credit-note.dto';
import { InvoiceNumberGenerator } from '../utils/invoice-number-generator';
import { RESOLUTION_PUBLIC_SELECT } from '../utils/technical-key.util';
import {
  localDateString,
  resolveStoreTimezone,
} from '../../../../common/utils/store-timezone.util';

/**
 * Este servicio NO necesita la ClTec: no calcula CUDE ni arma XML — eso lo hace
 * el emisor cuando la nota se transmite. Por eso la resolución se carga con
 * `RESOLUTION_PUBLIC_SELECT`, la lista blanca que deja las tres columnas de
 * clave técnica fuera de la respuesta (el porqué completo está en su docblock,
 * en `utils/technical-key.util.ts`).
 *
 * Con `resolution: true` la ClTec del rango de notas viajaba al navegador en
 * cada nota crédito o débito creada, exactamente igual que pasaba en las
 * facturas. Es el mismo defecto, en el archivo de al lado.
 */
const INVOICE_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: { select: RESOLUTION_PUBLIC_SELECT },
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
    private readonly fiscalScope: FiscalScopeService,
  ) {}

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
    const accounting_entity_id =
      await this.resolveAccountingEntityIdForContext(context);

    // Validate the related invoice exists and is accepted.
    // Las líneas y los impuestos se traen aquí porque una nota TOTAL (la que
    // sólo lleva motivo) los copia del documento que corrige.
    const related_invoice = await this.prisma.invoices.findFirst({
      where: { id: dto.related_invoice_id },
      include: { invoice_items: true, invoice_taxes: true },
    });

    if (!related_invoice) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    }

    // Una nota crédito/débito (tipos DIAN 91/92) sólo corrige una FACTURA. Cada
    // familia de documento tiene la suya y no son intercambiables:
    //   · documento equivalente POS  → nota de ajuste 93/94
    //     (`equivalent_adjustment_note`, Res. 000165/2023)
    //   · documento soporte          → nota de ajuste 95 (`support_adjustment_note`)
    //   · una nota                   → no se corrige con otra nota
    //
    // Sin esta puerta el servicio aceptaba cualquiera de esos, tomaba consecutivo
    // de la resolución de notas y recién la DIAN rechazaba el tipo — con el
    // número ya gastado. La única barrera existente era `isCorrectableType()` en
    // la UI, que no protege a ningún otro cliente de la API.
    const CORRECTABLE_BY_NOTE = [
      'sales_invoice',
      'export_invoice',
      'purchase_invoice',
    ];
    if (!CORRECTABLE_BY_NOTE.includes(related_invoice.invoice_type)) {
      const label = type === 'credit_note' ? 'nota crédito' : 'nota débito';
      const correct_instrument =
        related_invoice.invoice_type === 'pos_equivalent_document'
          ? 'Un documento equivalente POS se corrige con una nota de ajuste (tipo DIAN 93/94), no con una nota crédito o débito.'
          : related_invoice.invoice_type === 'support_document'
            ? 'Un documento soporte se corrige con una nota de ajuste al documento soporte (tipo DIAN 95).'
            : 'Sólo una factura puede corregirse con una nota crédito o débito.';
      throw new VendixHttpException(
        ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED,
        `El documento ${related_invoice.invoice_number} es de tipo «${related_invoice.invoice_type}» y no admite ${label}. ${correct_instrument}`,
        {
          related_invoice_id: related_invoice.id,
          related_invoice_type: related_invoice.invoice_type,
        },
      );
    }

    if (related_invoice.status !== 'accepted') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_002,
        `Cannot create ${type} for invoice in '${related_invoice.status}' status. Invoice must be accepted by DIAN first.`,
      );
    }

    const note_accounting_entity_id =
      related_invoice.accounting_entity_id || accounting_entity_id;
    if (note_accounting_entity_id !== accounting_entity_id) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_SCOPE_INVALID,
        'The related invoice belongs to a different fiscal entity.',
        {
          related_invoice_id: related_invoice.id,
          related_accounting_entity_id: related_invoice.accounting_entity_id,
          current_accounting_entity_id: accounting_entity_id,
        },
      );
    }

    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber({
        document_type: type,
        accounting_entity_id: note_accounting_entity_id,
      });

    // Nota TOTAL: sin líneas propias se copian las de la factura corregida.
    // Iterar `dto.items` sin este fallback lanzaba un `TypeError` crudo —un 500
    // «Error interno»— sobre lo que en realidad es una nota de anulación
    // perfectamente válida.
    const items = dto.items?.length
      ? dto.items
      : related_invoice.invoice_items.map((item) => ({
          product_id: item.product_id ?? undefined,
          product_variant_id: item.product_variant_id ?? undefined,
          description: item.description,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          discount_amount: Number(item.discount_amount ?? 0),
          tax_amount: Number(item.tax_amount ?? 0),
        }));

    if (!items.length) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CALC_001,
        `No hay líneas para la ${type === 'credit_note' ? 'nota crédito' : 'nota débito'}: ` +
          'no se enviaron y la factura que corrige tampoco tiene ninguna.',
        { related_invoice_id: related_invoice.id },
      );
    }

    // Los impuestos siguen a las líneas: si la nota es total y no trae los
    // suyos, copia también los de la factura, o el documento quedaría con base
    // gravable pero sin cuota.
    const taxes = dto.taxes?.length
      ? dto.taxes
      : dto.items?.length
        ? deriveNoteTaxesFromLines(items, related_invoice.invoice_taxes, type)
        : related_invoice.invoice_taxes.map((t) => ({
            tax_rate_id: t.tax_rate_id ?? undefined,
            tax_name: t.tax_name,
            tax_rate: Number(t.tax_rate),
            taxable_amount: Number(t.taxable_amount),
            tax_amount: Number(t.tax_amount),
            tax_type: t.tax_type,
          }));

    // Calculate amounts
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    for (const item of items) {
      subtotal += item.quantity * item.unit_price;
      discount += item.discount_amount || 0;
      tax += item.tax_amount || 0;
    }
    const total = subtotal - discount + tax;

    // Fecha fiscal de la nota: HOY en el huso de la tienda. Derivarla en el
    // navegador es de donde salen los desfases de un día.
    const issue_date = dto.issue_date
      ? new Date(dto.issue_date)
      : new Date(
          localDateString(
            new Date(),
            await resolveStoreTimezone(this.prisma, context.store_id!),
          ),
        );

    const note = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id: note_accounting_entity_id,
        fiscal_document_type: type,
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
        issue_date,
        created_by_user_id: context.user_id,
        notes: dto.notes || (dto as CreateCreditNoteDto).reason,
        invoice_items: {
          create: items.map((item) => {
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
        ...(taxes.length > 0 && {
            invoice_taxes: {
              create: taxes.map((tax_item, index) => {
                // `taxable_amount` y `tax_amount` son opcionales en
                // `CreateInvoiceTaxDto` porque en las FACTURAS los deriva
                // `InvoiceCalculatorService` a partir de la línea. Este servicio
                // no pasa por ese calculador —la nota copia los importes del
                // documento que corrige—, así que aquí no hay nada de donde
                // derivarlos y sí hay que exigirlos.
                //
                // Sin esta comprobación, `new Prisma.Decimal(undefined)` lanza un
                // `TypeError` crudo: 500 «Error interno» sobre lo que en realidad
                // es un campo que faltó en la petición.
                if (
                  tax_item.taxable_amount === undefined ||
                  tax_item.taxable_amount === null ||
                  tax_item.tax_amount === undefined ||
                  tax_item.tax_amount === null
                ) {
                  throw new VendixHttpException(
                    ErrorCodes.INVOICING_CALC_001,
                    `El impuesto «${tax_item.tax_name}» de la nota llegó sin taxable_amount o sin tax_amount. ` +
                      'Una nota crédito o débito no recalcula: copia los importes del documento que corrige, ' +
                      'así que ambos deben venir ya calculados.',
                    { tax_index: index, tax_name: tax_item.tax_name },
                  );
                }
                return {
                  tax_rate_id: tax_item.tax_rate_id,
                  tax_name: tax_item.tax_name,
                  tax_rate: new Prisma.Decimal(tax_item.tax_rate),
                  taxable_amount: new Prisma.Decimal(tax_item.taxable_amount),
                  tax_amount: new Prisma.Decimal(tax_item.tax_amount),
                  tax_type: ((tax_item as any).tax_type ?? 'iva') as any,
                };
              }),
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

/**
 * Nota PARCIAL sin desglose de impuestos propio.
 *
 * Antes esta rama devolvía `[]`, y ahí estaba el defecto: la cabecera SÍ suma
 * `item.tax_amount` (el bucle de totales de arriba), así que la nota quedaba
 * con cuota declarada y CERO filas en `invoice_taxes`. Reproducido en dev con
 * NCDEV2: `tax_amount = 28500`, `total = 178500`, ninguna fila.
 *
 * Al emitir, `LegalMonetaryTotal` incluye esos 28.500 mientras el documento no
 * lleva ningún `cac:TaxTotal` que los respalde. La DIAN valida esa identidad
 * aritméticamente y rechaza — quemando el consecutivo de la nota.
 *
 * Se deriva del perfil tributario del documento que se corrige, que es el único
 * origen legítimo: una nota no inventa tributos, corrige los de su factura.
 * Cuando la factura mezcla varios esquemas (IVA + INC, p. ej.) las líneas del
 * DTO sólo traen un `tax_amount` agregado y NO hay forma de repartirlo sin
 * adivinar, así que se exige el desglose explícito en vez de fabricarlo.
 */
function deriveNoteTaxesFromLines(
  items: Array<{
    quantity: number;
    unit_price: number;
    discount_amount?: number;
    tax_amount?: number;
  }>,
  invoice_taxes: Array<{
    tax_rate_id: number | null;
    tax_name: string;
    tax_rate: Prisma.Decimal;
    tax_type: string | null;
  }>,
  type: 'credit_note' | 'debit_note',
) {
  const note_tax = items.reduce((acc, i) => acc + (i.tax_amount || 0), 0);
  const note_base = items.reduce(
    (acc, i) => acc + i.quantity * i.unit_price - (i.discount_amount || 0),
    0,
  );

  // Sin cuota no hay nada que respaldar: líneas exentas o excluidas salen sin
  // `cac:TaxTotal`, que es exactamente lo que el Anexo 1.9 pide para ellas.
  if (note_tax === 0) return [];

  if (invoice_taxes.length !== 1) {
    const label = type === 'credit_note' ? 'nota crédito' : 'nota débito';
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CALC_001,
      invoice_taxes.length === 0
        ? `Las líneas de la ${label} declaran ${note_tax} de impuesto, pero la factura que corrigen no tiene ningún impuesto registrado del que derivarlo. Envía el desglose en «taxes».`
        : `La factura que corrige esta ${label} mezcla ${invoice_taxes.length} impuestos (${invoice_taxes.map((t) => t.tax_name).join(', ')}), y las líneas sólo traen el importe total. Envía el desglose en «taxes» indicando cuánto corresponde a cada uno.`,
      { note_tax_amount: note_tax, invoice_tax_schemes: invoice_taxes.length },
    );
  }

  const scheme = invoice_taxes[0];
  return [
    {
      tax_rate_id: scheme.tax_rate_id ?? undefined,
      tax_name: scheme.tax_name,
      tax_rate: Number(scheme.tax_rate),
      taxable_amount: note_base,
      tax_amount: note_tax,
      tax_type: scheme.tax_type,
    },
  ];
}
