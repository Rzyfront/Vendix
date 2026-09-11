import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { InvoiceEmissionGateService } from '../services/invoice-emission-gate.service';
import {
  CreateCreditNoteDto,
  CreateDebitNoteDto,
} from './dto/create-credit-note.dto';
import { InvoiceNumberGenerator } from '../utils/invoice-number-generator';
import { RESOLUTION_PUBLIC_SELECT } from '../utils/technical-key.util';
import { absorbInclusiveLine } from '../utils/dian-money.util';
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
    private readonly emissionGate: InvoiceEmissionGateService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      // B.1 (F-029) — 400 tipado en vez de 500 crudo.
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
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

    // ANTES de tomar el consecutivo, no después. Una línea que referencia un
    // artículo ajeno al catálogo de esta tienda tiene dos finales y los dos son
    // malos: el id inexistente revienta en la FK de `invoice_items` como un 500
    // «Error interno» —con el consecutivo autorizado ya gastado y sin manera de
    // devolverlo—, y el id de OTRA tienda satisface la FK y queda escrito en la
    // nota, que es una fuga de tenant que responde 201.
    //
    // La guarda gemela vive en `InvoicingService.resolveLinePricingSnapshots`,
    // que es el seam por el que pasan la creación y la edición de facturas. Las
    // notas no lo cruzan —construyen sus líneas por su cuenta—, así que la
    // protección hay que repetirla aquí; es el precio de tener dos carriles de
    // escritura, y se prefiere duplicar catorce líneas antes que dejar el
    // carril de notas sin puerta.
    await this.assertNoteLinesResolvable(dto.items);

    // ANTES de tomar el consecutivo, por la misma razón que la guarda de arriba:
    // un consecutivo gastado no se devuelve.
    //
    // Este carril no cruzaba la compuerta de emisión porque los dos criterios
    // vivían como métodos privados de `InvoicingService`. Medido el 2026-08-24
    // sobre la tienda 10, misma sesión y mismo token: `POST /store/invoicing`
    // respondía 403 `INVOICING_ENABLEMENT_001` y `POST .../credit-notes`
    // respondía 201, nota 169, número NC6, con `invoice_resolutions.current_number`
    // de la resolución 40 pasando de 5 a 6. La compuerta pertenece al acto de
    // NUMERAR, no al tipo de documento: la nota llama al mismo generador, con el
    // mismo `accounting_entity_id`, y la resolución se elige igual por
    // `document_type` sin mirar ambiente.
    //
    // La compuerta transitiva del `status = 'accepted'` de la factura
    // relacionada (arriba, `INVOICING_STATUS_002`) NO alcanza: basta una factura
    // histórica aceptada para que este carril quede abierto para siempre,
    // incluso si la habilitación de la tienda se cae después. Medido: 18
    // facturas con `status='accepted'`, 5 de ellas en la tienda 10.
    //
    // Se invoca el predicado compartido, no una copia. Y conserva su indulgencia
    // con quien no tiene configuración DIAN (`if (!config) return`), que cubre 20
    // de las 21 tiendas de dev: sin eso, la compuerta sería una pérdida de
    // función mayor que el hueco que cierra.
    const gate_context = this.getContext();
    await this.emissionGate.assertAreaActive({
      organization_id: gate_context.organization_id,
      store_id: gate_context.store_id,
    });

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
    //
    // B.1 (F-020) — la rama PARCIAL ya no suma floats ni persiste el
    // `tax_amount` del cliente: cada línea se deriva por el kernel único
    // `absorbInclusiveLine`, el mismo loop del motor, y la cabecera suma lo
    // derivado. La rama TOTAL sigue copia exacta (ver `derivePartialNote...`).
    const is_partial = !!dto.items?.length;
    const derived_partial = !dto.taxes?.length &&
      is_partial
        ? derivePartialNoteLinesViaKernel(
            items,
            related_invoice.invoice_items,
            related_invoice.invoice_taxes,
            related_invoice.id,
            type,
            this.logger,
          )
        : null;
    const taxes = dto.taxes?.length
      ? dto.taxes
      : derived_partial
        ? derived_partial.taxes
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
    let total = 0;
    if (derived_partial) {
      // Parcial por kernel: la cabecera suma base/cuota DERIVADAS, no el
      // reclamo del cliente. Todo en `Decimal`: ni un float en el camino.
      subtotal = derived_partial.totals.subtotal.toNumber();
      discount = derived_partial.totals.discount.toNumber();
      tax = derived_partial.totals.tax.toNumber();
      total = derived_partial.totals.total.toNumber();
    } else {
      for (const item of items) {
        subtotal += item.quantity * item.unit_price;
        discount += item.discount_amount || 0;
        tax += item.tax_amount || 0;
      }
      total = subtotal - discount + tax;
    }

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
        // Concepto DIAN (`cac:DiscrepancyResponse/cbc:ResponseCode`). El DTO ya
        // validó que el código pertenece al catálogo de ESTE tipo de nota —los
        // dos catálogos son distintos—, así que aquí sólo se persiste.
        //
        // `?? null` explícito: ausente NO es '2'. La columna queda NULL y es el
        // builder quien cae al literal histórico, en un solo lugar. Traducir el
        // vacío a '2' acá dejaría indistinguibles «el usuario eligió anulación»
        // y «esta nota nació sin concepto», que es justo lo que hay que poder
        // separar para saber qué se declaró de verdad.
        note_concept_code: dto.note_concept_code ?? null,
        invoice_items: {
          create: items.map((item, index) => {
            // B.1 (F-020) — parcial por kernel: la línea persiste base/cuota
            // derivadas (nunca el reclamo del cliente). Total/explícito:
            // idéntico a siempre.
            const derived_line = derived_partial?.lines[index];
            const line_tax =
              derived_line?.tax_amount ??
              new Prisma.Decimal(item.tax_amount || 0);
            const item_total = derived_line
              ? derived_line.total_amount
              : new Prisma.Decimal(item.quantity)
                  .times(item.unit_price)
                  .minus(item.discount_amount || 0)
                  .plus(item.tax_amount || 0);
            return {
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              description: item.description,
              quantity: new Prisma.Decimal(item.quantity),
              unit_price: new Prisma.Decimal(item.unit_price),
              discount_amount: new Prisma.Decimal(item.discount_amount || 0),
              tax_amount: line_tax,
              total_amount: item_total,
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

  /**
   * Rechaza una nota cuyas líneas referencian artículos que el catálogo de esta
   * tienda no devuelve.
   *
   * Sólo mira `dto.items`. Las líneas de la nota TOTAL se copian de
   * `related_invoice.invoice_items`, cuyos ids ya satisfacen la FK por
   * construcción: volver a consultarlos sería una consulta por nota para
   * confirmar algo que la base ya garantiza.
   *
   * Las dos consultas van por `this.prisma`, que scopea `products` por tienda y
   * `product_variants` por relación. Por eso «no está en el mapa» significa a la
   * vez «no existe» y «es de otra tienda», y por eso un solo control cierra los
   * dos agujeros: el 500 por FK y la fuga de tenant que respondía 201.
   *
   * 422 y no 404: no falta el recurso que se pidió —la nota se está creando—,
   * sino que el cuerpo referencia uno que no es de quien escribe.
   */
  private async assertNoteLinesResolvable(
    items: CreateCreditNoteDto['items'],
  ): Promise<void> {
    if (!items?.length) return;

    const product_ids = [
      ...new Set(
        items
          .map((item) => item.product_id)
          .filter((id): id is number => id != null),
      ),
    ];
    const variant_ids = [
      ...new Set(
        items
          .map((item) => item.product_variant_id)
          .filter((id): id is number => id != null),
      ),
    ];
    if (!product_ids.length && !variant_ids.length) return;

    const [products, variants] = await Promise.all([
      product_ids.length
        ? this.prisma.products.findMany({
            where: { id: { in: product_ids } },
            select: { id: true },
          })
        : Promise.resolve([]),
      variant_ids.length
        ? this.prisma.product_variants.findMany({
            where: { id: { in: variant_ids } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const found_products = new Set(products.map((p) => p.id));
    const found_variants = new Set(variants.map((v) => v.id));
    const rejected_products = product_ids.filter((id) => !found_products.has(id));
    const rejected_variants = variant_ids.filter((id) => !found_variants.has(id));
    if (!rejected_products.length && !rejected_variants.length) return;

    const parts = [
      rejected_products.length
        ? `producto(s) ${rejected_products.join(', ')}`
        : null,
      rejected_variants.length
        ? `variante(s) ${rejected_variants.join(', ')}`
        : null,
    ].filter(Boolean);
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CALC_003,
      `La nota referencia ${parts.join(' y ')} que no existen en el catálogo de esta tienda. ` +
        'Selecciónalos desde el buscador de productos, o deja la línea sin producto si es un ítem libre.',
      {
        rejected_product_ids: rejected_products,
        rejected_product_variant_ids: rejected_variants,
      },
    );
  }
}

/**
 * Línea parcial derivada por el kernel (B.1, F-020): base, cuota y total en
 * `Decimal`, listos para persistir.
 */
export interface DerivedPartialNoteLine {
  base_amount: Prisma.Decimal;
  tax_amount: Prisma.Decimal;
  total_amount: Prisma.Decimal;
  is_inclusive: boolean;
}

/**
 * Nota PARCIAL sin desglose de impuestos propio, derivada por el kernel.
 *
 * B.1 (F-020) — antes esta rama sumaba floats y persistía el `tax_amount`
 * del cliente, que puede violar `cuota = trunc(base × rate)` y quemar el
 * consecutivo en DIAN (una parcial sobre línea absorbida de $3.000 → base
 * 2777.78 + 222.22 salía con cualquier otro reparto que el cliente mandara).
 * Ahora cada línea pasa por `absorbInclusiveLine` —el mismo loop del motor—:
 * la cuota que se persiste ES `trunc(base_final × rate)` por construcción, y
 * la cabecera suma lo derivado, nunca el reclamo.
 *
 * Lo que NO cambia (copia exacta): la nota TOTAL (sin `dto.items`) copia
 * líneas e impuestos de la factura que corrige tal cual; el desglose
 * explícito (`dto.taxes`) manda sobre lo derivado.
 *
 * Falla cerrada ANTES de numerar (el llamador numera después): entrada
 * inválida ⇒ `INVOICING_CALC_006`; bruto inalcanzable ⇒ `INVOICING_CALC_005`.
 * Sin cuota derivada no hay nada que respaldar: líneas exentas o excluidas
 * salen sin `cac:TaxTotal`, que es exactamente lo que el Anexo 1.9 pide.
 *
 * La inclusividad de cada línea sale del DTO (`is_inclusive` de la línea o
 * de su primer impuesto, herencia del motor) y, en su defecto, de la línea
 * de la factura que corrige (misma pareja producto+variante, o la única
 * línea cuando la factura trae una sola). Sin dato ⇒ adicional (default
 * histórico). Las líneas de nota no traen `price_unit_quantity` (el DTO no
 * lo acepta: lo resuelve el servidor desde el producto al facturar), así que
 * el divisor es 1 y el precio del DTO ya es por unidad.
 */
export function derivePartialNoteLinesViaKernel(
  items: Array<{
    product_id?: number | null;
    product_variant_id?: number | null;
    description?: string;
    quantity: number;
    unit_price: number;
    discount_amount?: number | null;
    tax_amount?: number | null;
    is_inclusive?: boolean | null;
    taxes?: Array<{ is_inclusive?: boolean | null }> | null;
  }>,
  related_items: Array<{
    product_id: number | null;
    product_variant_id: number | null;
    is_inclusive: boolean | null;
  }>,
  invoice_taxes: Array<{
    tax_rate_id: number | null;
    tax_name: string;
    tax_rate: Prisma.Decimal | number;
    tax_type: string | null;
  }>,
  related_invoice_id: number,
  type: 'credit_note' | 'debit_note',
  logger?: { warn(message: string): void },
): {
  taxes: Array<{
    tax_rate_id: number | undefined;
    tax_name: string;
    tax_rate: number;
    taxable_amount: number;
    tax_amount: number;
    tax_type: string | null;
  }>;
  lines: DerivedPartialNoteLine[];
  totals: {
    subtotal: Prisma.Decimal;
    discount: Prisma.Decimal;
    tax: Prisma.Decimal;
    total: Prisma.Decimal;
  };
} {
  if (invoice_taxes.length !== 1) {
    const label = type === 'credit_note' ? 'nota crédito' : 'nota débito';
    const claimed = items.reduce(
      (acc, i) => acc.plus(new Prisma.Decimal(i.tax_amount || 0)),
      new Prisma.Decimal(0),
    );
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CALC_001,
      invoice_taxes.length === 0
        ? `Las líneas de la ${label} declaran ${claimed.toString()} de impuesto, pero la factura que corrigen no tiene ningún impuesto registrado del que derivarlo. Envía el desglose en «taxes».`
        : `La factura que corrige esta ${label} mezcla ${invoice_taxes.length} impuestos (${invoice_taxes.map((t) => t.tax_name).join(', ')}), y las líneas sólo traen el importe total. Envía el desglose en «taxes» indicando cuánto corresponde a cada uno.`,
      {
        note_tax_amount: claimed.toNumber(),
        invoice_tax_schemes: invoice_taxes.length,
      },
    );
  }

  const scheme = invoice_taxes[0];
  const scheme_type = (scheme.tax_type ?? '').trim().toLowerCase() || 'iva';
  // Espejo de `resolveRateBasis` del motor y de `rateFractionPpm` del
  // preview: sin `rate_basis` explícito el ICA (y su retención) van POR MIL.
  const rate_basis =
    scheme_type === 'ica' || scheme_type === 'reteica'
      ? ('per_mil' as const)
      : ('percent' as const);
  const scheme_rate = Number(scheme.tax_rate);

  const single_related =
    related_items.length === 1 ? related_items[0] : undefined;
  const lines: DerivedPartialNoteLine[] = items.map((item, index) => {
    const quantity = new Prisma.Decimal(item.quantity);
    const unit_price = new Prisma.Decimal(item.unit_price);
    const discount = new Prisma.Decimal(item.discount_amount || 0);
    const gross = quantity.times(unit_price).minus(discount);

    // Herencia de inclusividad del motor: flag de línea ⇒ primer impuesto
    // del DTO ⇒ línea de la factura (misma pareja, o la única) ⇒ adicional.
    let is_inclusive: boolean | undefined;
    if (item.is_inclusive === true) is_inclusive = true;
    else if (item.is_inclusive === false) is_inclusive = false;
    else if (item.taxes?.[0]?.is_inclusive === true) is_inclusive = true;
    else if (item.taxes?.[0]?.is_inclusive === false) is_inclusive = false;
    if (is_inclusive === undefined) {
      const match =
        related_items.find(
          (rel) =>
            (rel.product_id ?? null) === (item.product_id ?? null) &&
            (rel.product_variant_id ?? null) ===
              (item.product_variant_id ?? null),
        ) ?? single_related;
      is_inclusive = match?.is_inclusive === true;
    }

    const kernel = absorbInclusiveLine({
      gross,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount ?? 0,
      rates: [
        {
          rate: scheme_rate,
          rate_basis,
          tax_type: scheme_type,
          is_inclusive,
        },
      ],
    });

    if (kernel.invalid_inputs.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CALC_006,
        `La línea ${index + 1}${item.description ? ` («${item.description}»)` : ''} de la nota trae una entrada inválida (${kernel.invalid_inputs.join(', ')}): corrige la línea en vez de emitirla en cero.`,
        {
          line_index: index,
          detail: kernel.invalid_inputs.join(', '),
          related_invoice_id,
        },
      );
    }
    if (!kernel.closed_exactly) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CALC_005,
        `La línea ${index + 1}${item.description ? ` («${item.description}»)` : ''} con precio impuesto-incluido no puede cerrar al total de ${kernel.gross.toString()}: base más cuotas truncadas llega a ${kernel.closed_total.toString()}. Ajusta el precio o el descuento en 1 centavo y vuelve a intentarlo; re-guardar el mismo importe repite el mismo rechazo.`,
        {
          line_index: index,
          expected: kernel.gross.toString(),
          received: kernel.closed_total.toString(),
          difference: kernel.unclosed_residual_cents,
          related_invoice_id,
        },
      );
    }

    const quota = kernel.quotas[0]?.quota ?? new Prisma.Decimal(0);
    const claimed_tax = new Prisma.Decimal(item.tax_amount || 0);
    if (!claimed_tax.equals(quota)) {
      logger?.warn(
        `credit-note partial line ${index + 1} of invoice #${related_invoice_id}: ` +
          `client tax_amount=${claimed_tax.toString()} replaced by kernel quota=${quota.toString()} (server wins)`,
      );
    }
    return {
      base_amount: kernel.base,
      tax_amount: quota,
      total_amount: kernel.closed_total,
      is_inclusive,
    };
  });

  const totals = lines.reduce(
    (acc, line, index) => ({
      subtotal: acc.subtotal.plus(line.base_amount),
      discount: acc.discount.plus(
        new Prisma.Decimal(items[index].discount_amount || 0),
      ),
      tax: acc.tax.plus(line.tax_amount),
      total: acc.total.plus(line.total_amount),
    }),
    {
      subtotal: new Prisma.Decimal(0),
      discount: new Prisma.Decimal(0),
      tax: new Prisma.Decimal(0),
      total: new Prisma.Decimal(0),
    },
  );

  if (totals.tax.isZero()) return { taxes: [], lines, totals };
  return {
    taxes: [
      {
        tax_rate_id: scheme.tax_rate_id ?? undefined,
        tax_name: scheme.tax_name,
        tax_rate: scheme_rate,
        taxable_amount: totals.subtotal.toNumber(),
        tax_amount: totals.tax.toNumber(),
        tax_type: scheme.tax_type,
      },
    ],
    lines,
    totals,
  };
}
