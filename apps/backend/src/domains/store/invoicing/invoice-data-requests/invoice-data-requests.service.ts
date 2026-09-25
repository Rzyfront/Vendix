import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { SubmitInvoiceDataDto } from './dto/submit-invoice-data.dto';
import {
  INVOICE_DATA_REQUEST_STATUSES,
  QueryInvoiceDataRequestsDto,
} from './dto/query-invoice-data-requests.dto';
import { InvoiceDataRequestEvent } from './interfaces/invoice-data-request-events.interface';
import { InvoicingService } from '../invoicing.service';
import { CreditNotesService } from '../credit-notes/credit-notes.service';
import { InvoiceFlowService } from '../invoice-flow/invoice-flow.service';
import { CreateCreditNoteDto } from '../credit-notes/dto/create-credit-note.dto';
import { CreateInvoiceTaxDto } from '../dto/create-invoice.dto';
import {
  DEFAULT_STORE_TIMEZONE,
  localDateString,
} from '@common/utils/store-timezone.util';
// C.7 (CP-pos-exclusive-tax-double-charge, ADR-12) — mismo resolvedor que usan
// los providers del gateway de impresión para las superficies `@OptionalAuth`.
import { resolvePrintsVatBreakdownForPrint } from '../../print-formats/services/print-vat-breakdown.resolver';

interface InvoiceDataRequestCustomerData {
  first_name?: string | null;
  last_name?: string | null;
  document_type?: string | null;
  document_number?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Paso 6 (roku-shop-checkout-tarifa-detalle-orden) — binding liviano
 * token→orden para el stream SSE guest. Ambos ids se derivan SERVER-SIDE
 * del token; el controller los usa como clave default-deny del filtro.
 */
export interface GuestStreamBinding {
  order_id: number;
  store_id: number;
}

type NominativeConversionStrategy =
  | 'updated_in_place'
  | 'credit_note_reissue'
  | 'issued_new'
  | 'deferred';

interface NominativeConversionResult {
  new_invoice_id: number | null;
  credit_note_id: number | null;
  strategy: NominativeConversionStrategy;
}

@Injectable()
export class InvoiceDataRequestsService {
  private readonly logger = new Logger(InvoiceDataRequestsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly invoicingService: InvoicingService,
    private readonly creditNotesService: CreditNotesService,
    private readonly invoiceFlowService: InvoiceFlowService,
    private readonly s3Service: S3Service,
  ) {}

  // `S3PathHelper` es stateless (sin constructor): se instancia directo en
  // vez de inyectarlo para NO cambiar la aridad del constructor — el spec
  // existente construye el servicio con 6 args y `buildcheck:types` (CI)
  // tipa los specs. La key sigue centralizada en el helper (skill
  // vendix-s3-storage), solo cambia cómo se obtiene.
  private readonly receiptPaths = new S3PathHelper();

  /**
   * Create a new invoice data request when a CF sale is completed.
   * Called internally by the POS payment flow.
   */
  async createRequest(
    storeId: number,
    orderId: number,
    invoiceId?: number,
    customerData?: InvoiceDataRequestCustomerData | null,
  ) {
    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30-day expiry

    const request = await this.prisma.invoice_data_requests.create({
      data: {
        store_id: storeId,
        order_id: orderId,
        invoice_id: invoiceId || null,
        token,
        first_name: customerData?.first_name || null,
        last_name: customerData?.last_name || null,
        document_type: customerData?.document_type || null,
        document_number: customerData?.document_number || null,
        email: customerData?.email || null,
        phone: customerData?.phone || null,
        status: 'pending',
        expires_at: expiresAt,
      },
    });

    this.eventEmitter.emit('invoice_data_request.created', {
      store_id: storeId,
      request_id: request.id,
      order_id: orderId,
      token,
      status: 'pending',
    } as InvoiceDataRequestEvent);

    // F3 (roku-shop-checkout-tarifa-detalle-orden) — el token es la
    // capability guest: jamás se loguea (antes iba en claro en esta línea).
    // El `request.id` basta para correlacionar en los logs.
    this.logger.log(
      `Invoice data request #${request.id} created for order #${orderId}`,
    );

    return request;
  }

  /**
   * Get request info by token (for the public form).
   * Returns order details so the customer can verify their purchase.
   */
  async getByToken(token: string) {
    const request = await this.prisma.invoice_data_requests.findUnique({
      where: { token },
      include: {
        order: {
          select: {
            id: true,
            order_number: true,
            grand_total: true,
            created_at: true,
            // [resid-fiscal] — Excluir ítems cancelados (soft cancel D2).
            // La lista llega al cliente vía QR de "Solicite su factura
            // electrónica"; un cancelado con monto descolgaría el total
            // agregado del `grand_total` que ya está excluido.
            order_items: {
              where: { cancelled_at: null },
              select: {
                product_name: true,
                quantity: true,
                unit_price: true,
                total_price: true,
              },
            },
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            logo_url: true,
          },
        },
      },
    });

    if (!request) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DATA_REQUEST_002,
        'El enlace para solicitar tu factura no es válido. Pídele a la tienda uno nuevo.',
      );
    }

    if (request.status === 'completed') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DATA_REQUEST_004,
        'Tu factura ya fue emitida con los datos que enviaste. Si necesitas una copia, escríbele a la tienda.',
      );
    }

    if (request.status === 'expired' || request.expires_at < new Date()) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DATA_REQUEST_003,
        'El enlace para solicitar tu factura venció. Pídele a la tienda uno nuevo.',
      );
    }

    return request;
  }

  /**
   * C.8 (CP-pos-exclusive-tax-double-charge, ADR-06, FB-15) — `unit_price`/
   * `total_price` siguen en la BASE (R-1: ningún lector viejo cambia de
   * magnitud). El bruto viaja en campos ADITIVOS nuevos, derivado con el
   * mismo fallback textual del ADR: `final_unit_price` si ya está poblado,
   * si no `unit_price + tax_amount_item / line_units`. Mismo cálculo puro
   * que `account.service.ts#deriveLineGross` — duplicado a propósito (no
   * importado): ese archivo vive en el dominio `ecommerce/account` y este
   * en `store/invoicing`, y ya hay una segunda copia local en
   * `ecommerce-tables.service.ts` por la misma razón de no cruzar dominios
   * para una función de 6 líneas.
   */
  private deriveLineGross(item: {
    unit_price: any;
    total_price: any;
    tax_amount_item?: any;
    final_unit_price?: any;
    price_unit_quantity?: any;
    quantity: any;
  }): { unit_price_gross: number; line_total_gross: number } {
    const netUnit = Number(item.unit_price ?? 0);
    const netTotal = Number(item.total_price ?? 0);
    const lineUnits = Number(item.price_unit_quantity ?? item.quantity ?? 1) || 1;
    const grossUnit =
      item.final_unit_price != null
        ? Number(item.final_unit_price)
        : netUnit + Number(item.tax_amount_item ?? 0) / lineUnits;
    const multiplier = netUnit !== 0 ? netTotal / netUnit : Number(item.quantity ?? 0);
    const grossTotal = Math.round(grossUnit * multiplier * 100) / 100;
    return {
      unit_price_gross: Math.round(grossUnit * 100) / 100,
      line_total_gross: grossTotal,
    };
  }

  /**
   * Paso 3 — espejo backend de `kitchenStateFor` (order-details-page):
   * prefiere una fila in-flight (`pending`/`in_preparation`/`ready`) sobre
   * la más reciente terminal; las filas ya vienen `orderBy: { id: 'desc' }`.
   * `null` = el ítem nunca se disparó a cocina (sin badge).
   */
  private kitchenStatusFor(
    ticketItems: { id: number; status: string }[] | null | undefined,
  ): string | null {
    if (!ticketItems || ticketItems.length === 0) return null;
    const inFlight = ticketItems.find(
      (k) =>
        k.status === 'pending' ||
        k.status === 'in_preparation' ||
        k.status === 'ready',
    );
    if (inFlight) return inFlight.status;
    return ticketItems[0].status;
  }

  /**
   * Public read-only order summary for anonymous ecommerce checkouts.
   * Unlike getByToken(), this endpoint must keep working after the invoice
   * data request is submitted/completed so guests retain purchase support.
   */
  async getOrderSummaryByToken(token: string) {
    const request = await this.prisma.invoice_data_requests.findUnique({
      where: { token },
      include: {
        order: {
          include: {
            // [resid-fiscal] — Mismo filtro que arriba: el summary va a
            // la página pública del cliente. Si quedara un cancelado,
            // vería una línea con `total_price` que el total agregado
            // ya no suma — inconsistencia visible.
            order_items: {
              where: { cancelled_at: null },
              select: {
                product_name: true,
                variant_sku: true,
                variant_attributes: true,
                variant_image_url: true,
                quantity: true,
                unit_price: true,
                total_price: true,
                tax_amount_item: true,
                // C.8 (ADR-06) — insumos del fallback de bruto derivado
                // (`final_unit_price ?? unit_price + tax_amount_item/line_units`).
                // Mismo campo que `account.service.ts#deriveLineGross`
                // necesita para el mismo cálculo.
                final_unit_price: true,
                price_unit_quantity: true,
                // Paso 3 (roku-shop-checkout-tarifa-detalle-orden): cocina en
                // vivo por plato + ETA variant-aware. Solo estado e id del
                // ticket-item: nada de notas internas ni joins a tickets.
                kitchen_ticket_items: {
                  orderBy: { id: 'desc' },
                  select: { id: true, status: true },
                },
                product_variants: {
                  select: { preparation_time_minutes: true },
                },
                products: {
                  select: {
                    preparation_time_minutes: true,
                    product_images: {
                      where: { is_main: true },
                      take: 1,
                      select: { image_url: true },
                    },
                  },
                },
              },
            },
            payments: {
              select: {
                id: true,
                state: true,
                amount: true,
                paid_at: true,
                // Paso 3: presencia de comprobante. La key NUNCA sale en el
                // payload — solo `has_receipt` + content-type del HEAD.
                receipt_s3_key: true,
                store_payment_method: {
                  select: {
                    display_name: true,
                    system_payment_method: {
                      select: { display_name: true, type: true },
                    },
                  },
                },
              },
            },
            invoices: {
              select: {
                id: true,
                invoice_number: true,
                status: true,
                pdf_url: true,
              },
              orderBy: { created_at: 'desc' },
              take: 1,
            },
            // Persisted discount snapshots — read what was actually charged,
            // never recalculate against current promotions/coupons.
            order_promotions: {
              select: {
                id: true,
                promotion_id: true,
                discount_amount: true,
                created_at: true,
                promotions: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    type: true,
                    scope: true,
                    value: true,
                  },
                },
              },
              orderBy: { created_at: 'asc' },
            },
            coupon_uses: {
              select: {
                id: true,
                coupon_id: true,
                discount_applied: true,
                used_at: true,
                coupon: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    discount_type: true,
                    discount_value: true,
                  },
                },
              },
              orderBy: { used_at: 'asc' },
            },
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            logo_url: true,
            // C.7 (CP-pos-exclusive-tax-double-charge, ADR-12) — insumos de
            // `resolvePrintsVatBreakdownForPrint`, misma forma que los
            // providers del gateway de impresión. Este endpoint es
            // `@Public()` (pedido de invitado): no hay usuario del que leer
            // el estado fiscal, así que viaja resuelto en el payload.
            store_settings: { select: { settings: true } },
            organizations: {
              select: {
                fiscal_scope: true,
                organization_settings: { select: { settings: true } },
              },
            },
          },
        },
      },
    });

    if (!request) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DATA_REQUEST_002,
        'El enlace para solicitar tu factura no es válido. Pídele a la tienda uno nuevo.',
      );
    }

    // Paso 3: mismo default que `OrderEtaService.computeEta` (paso 5):
    // `operations.default_preparation_time_minutes` de la tienda, 15 si ausente.
    // Los settings ya vienen cargados para el gate fiscal (C.7) — sin query extra.
    const defaultPrep =
      (request.store?.store_settings?.settings as any)?.operations
        ?.default_preparation_time_minutes ?? 15;

    // Sign image URLs per item (mirrors account.service getOrderDetail).
    const items = await Promise.all(
      request.order.order_items.map(async (item) => ({
        product_name: item.product_name,
        variant_sku: item.variant_sku,
        variant_attributes: item.variant_attributes,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        tax_amount_item: item.tax_amount_item,
        ...this.deriveLineGross(item as any),
        // Paso 3: cocina en vivo + prep resuelto variante→producto (null si
        // ninguno lo define; el default solo aplica al MAX agregado).
        kitchen_status: this.kitchenStatusFor(item.kitchen_ticket_items),
        preparation_time_minutes:
          item.product_variants?.preparation_time_minutes ??
          item.products?.preparation_time_minutes ??
          null,
        image_url: item.products?.product_images?.[0]?.image_url
          ? await this.s3Service.signUrl(item.products.product_images[0].image_url)
          : null,
        variant_image_url: item.variant_image_url
          ? await this.s3Service.signUrl(item.variant_image_url)
          : null,
      })),
    );

    // Paso 3: MAX por ítem con la regla exacta de `computeEta`
    // (variante ?? producto ?? default tienda) — coherente con el paso 5.
    const prep_minutes_max = items.length
      ? Math.max(
          ...items.map(
            (item) => item.preparation_time_minutes ?? defaultPrep,
          ),
        )
      : defaultPrep;

    // Paso 3: comprobante por pago. `receipt_content_type` no se persiste
    // (igual que `getPaymentReceiptUrl`): HEAD del objeto S3 por lectura,
    // fail-soft a null si el objeto no existe.
    const payments = await Promise.all(
      request.order.payments.map(async (payment) => {
        const hasReceipt = !!payment.receipt_s3_key;
        const head = hasReceipt
          ? await this.s3Service.headObject(payment.receipt_s3_key)
          : null;
        return {
          payment_id: payment.id,
          state: payment.state,
          amount: payment.amount,
          paid_at: payment.paid_at,
          method:
            payment.store_payment_method?.display_name ||
            payment.store_payment_method?.system_payment_method?.display_name ||
            payment.store_payment_method?.system_payment_method?.type ||
            null,
          has_receipt: hasReceipt,
          receipt_content_type: head?.contentType ?? null,
        };
      }),
    );

    // C.7 (ADR-12) — mismo gate fiscal que el gateway de impresión, resuelto
    // aquí porque el endpoint es `@Public()` (sin usuario del que leerlo).
    // `resolvePrintsVatBreakdownForPrint` es fail-closed: sin settings o sin
    // responsabilidad de IVA declarada, devuelve `false`.
    const printsVatBreakdown = resolvePrintsVatBreakdownForPrint(
      request.store?.organizations,
      request.store,
    );

    return {
      token: request.token,
      invoice_data_status: request.status,
      invoice_data_expires_at: request.expires_at,
      prints_vat_breakdown: printsVatBreakdown,
      customer: {
        first_name: request.first_name,
        last_name: request.last_name,
        document_type: request.document_type,
        document_number: request.document_number,
        email: request.email,
        phone: request.phone,
      },
      store: {
        id: request.store.id,
        name: request.store.name,
        logo_url: request.store.logo_url,
      },
      order: {
        id: request.order.id,
        order_number: request.order.order_number,
        state: request.order.state,
        channel: request.order.channel,
        subtotal_amount: request.order.subtotal_amount,
        discount_amount: request.order.discount_amount,
        tax_amount: request.order.tax_amount,
        shipping_cost: request.order.shipping_cost,
        grand_total: request.order.grand_total,
        currency: request.order.currency,
        created_at: request.order.created_at,
        placed_at: request.order.placed_at,
        // Paso 3: ETA persistido + MAX en vivo + tipo de entrega.
        estimated_ready_at: request.order.estimated_ready_at,
        estimated_delivered_at: request.order.estimated_delivered_at,
        prep_minutes_max,
        delivery_type: request.order.delivery_type,
        shipping_address: request.order.shipping_address_snapshot,
        items,
        // Historical discount snapshots persisted on the order.
        applied_promotions: request.order.order_promotions.map((op) => ({
          id: op.id,
          promotion_id: op.promotion_id,
          name: op.promotions?.name ?? null,
          code: op.promotions?.code ?? null,
          type: op.promotions?.type ?? null,
          scope: op.promotions?.scope ?? null,
          value: op.promotions?.value ?? null,
          discount_amount: op.discount_amount,
          created_at: op.created_at,
        })),
        applied_coupons: request.order.coupon_uses.map((cu) => ({
          id: cu.id,
          coupon_id: cu.coupon_id,
          code: cu.coupon?.code ?? null,
          name: cu.coupon?.name ?? null,
          discount_type: cu.coupon?.discount_type ?? null,
          discount_value: cu.coupon?.discount_value ?? null,
          discount_applied: cu.discount_applied,
          used_at: cu.used_at,
        })),
        payments,
        invoice: request.order.invoices[0] || null,
      },
    };
  }

  /**
   * Paso 4 (roku-shop-checkout-tarifa-detalle-orden) — mismo contrato de
   * archivo que el checkout (`CheckoutService.RECEIPT_ALLOWED_MIME_TYPES` +
   * `FileInterceptor` 5MB): el guest puede releer y cargar tardíamente el
   * comprobante de transferencia/voucher de SU pedido.
   */
  private static readonly RECEIPT_ALLOWED_MIME_TYPES: readonly string[] = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];
  private static readonly RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
  private static readonly RECEIPT_URL_TTL_SECONDS = 300;

  /**
   * Paso 4 — binding server-side token→orden→pago para los endpoints guest
   * de comprobante. La query es UNA sola lectura relacional desde
   * `invoice_data_requests` (getter SIN scope: el token es global por
   * diseño, paso 3) y el vínculo pago↔orden lo impone la propia relación
   * (`payments.where.order_id`), no un parámetro del cliente. No depende
   * del `store_id` del contexto: funciona con host resuelto, `?store_id=` o
   * sin ninguno.
   *
   * 404 ciego: token ajeno/inexistente y pago de otra orden responden el
   * mismo shape de "no existe" sin distinguirlos.
   */
  private async resolveGuestPayment(token: string, paymentId: number) {
    const request = await this.prisma.invoice_data_requests.findUnique({
      where: { token },
      select: {
        id: true,
        store_id: true,
        order_id: true,
        order: {
          select: {
            id: true,
            // R8-F1 — el gate de estados de `uploadGuestPaymentReceipt`
            // necesita ambos `state`; el path de lectura
            // (`getGuestPaymentReceiptUrl`) los ignora.
            state: true,
            payments: {
              where: { id: paymentId },
              select: {
                id: true,
                order_id: true,
                state: true,
                receipt_s3_key: true,
                receipt_uploaded_at: true,
                store_payment_method: {
                  select: {
                    system_payment_method: { select: { type: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!request) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DATA_REQUEST_002,
        'El enlace para solicitar tu factura no es válido. Pídele a la tienda uno nuevo.',
      );
    }

    const payment = request.order?.payments?.[0] ?? null;
    if (!payment) {
      throw new VendixHttpException(ErrorCodes.PAY_FIND_001);
    }

    return { request, payment };
  }

  /**
   * Paso 6 — binding server-side token→`{order_id, store_id}` para el
   * stream SSE guest. UNA lectura mínima por `token` (global por diseño,
   * igual que `resolveGuestPayment`), sin joins ni throws: `null` = token
   * desconocido y el controller cierra la conexión sin emitir datos
   * (404 ciego, sin distinguir de "tienda ajena").
   */
  async resolveGuestStreamBinding(
    token: string,
  ): Promise<GuestStreamBinding | null> {
    if (!token || typeof token !== 'string') {
      return null;
    }
    const request = await this.prisma.invoice_data_requests.findUnique({
      where: { token },
      select: { order_id: true, store_id: true },
    });
    if (!request) {
      return null;
    }
    return { order_id: request.order_id, store_id: request.store_id };
  }

  /**
   * Paso 4 — clon guest de `CheckoutService.getPaymentReceiptUrl`: URL
   * firmada TTL 5 min + HEAD de content-type. La autorización es el binding
   * de arriba (capability = token uuid en path), no el scope de comprador.
   */
  async getGuestPaymentReceiptUrl(
    token: string,
    paymentId: number,
  ): Promise<{ url: string; expires_at: string; content_type: string | null }> {
    const { payment } = await this.resolveGuestPayment(token, paymentId);

    if (!payment.receipt_s3_key) {
      throw new VendixHttpException(ErrorCodes.PAY_RECEIPT_NOT_FOUND_001);
    }

    const TTL_SECONDS =
      InvoiceDataRequestsService.RECEIPT_URL_TTL_SECONDS;
    const [url, head] = await Promise.all([
      this.s3Service.getPresignedUrl(payment.receipt_s3_key, TTL_SECONDS),
      this.s3Service.headObject(payment.receipt_s3_key),
    ]);
    const expires_at = new Date(
      Date.now() + TTL_SECONDS * 1000,
    ).toISOString();

    return { url, expires_at, content_type: head?.contentType ?? null };
  }

  /**
   * Paso 4 — subida tardía del comprobante desde la vista guest. Mismo
   * contrato que el checkout: solo métodos `bank_transfer`/`voucher`
   * (el tipo ya es visible en el summary, así que el 400 no filtra nada
   * nuevo), MIME imagen/PDF, 5MB (el `FileInterceptor` del controller
   * corta con 413; la guarda de acá es defensa si la config deriva).
   *
   * Re-subir REEMPLAZA la key (mismo orphan-policy que el checkout: el
   * objeto viejo se purga offline, sin rollback en el happy path).
   */
  async uploadGuestPaymentReceipt(
    token: string,
    paymentId: number,
    file: Express.Multer.File | undefined,
  ): Promise<{
    payment_id: number;
    has_receipt: boolean;
    receipt_content_type: string | null;
    receipt_uploaded_at: Date;
  }> {
    const { request, payment } = await this.resolveGuestPayment(
      token,
      paymentId,
    );

    // R8-F1 — sin comprobantes tardíos sobre estados terminales: la orden
    // ya se cerró o el pago ya se resolvió y el recibo no cambiaría nada.
    // Mismo código que el gate de método (400, mensaje ES al guest).
    const TERMINAL_ORDER_STATES = ['cancelled', 'refunded', 'finished', 'delivered'];
    const TERMINAL_PAYMENT_STATES = ['succeeded', 'captured', 'refunded', 'cancelled'];
    if (TERMINAL_ORDER_STATES.includes(request.order?.state as string)) {
      throw new VendixHttpException(
        ErrorCodes.PAY_VALIDATE_001,
        'Esta orden ya está cerrada y no recibe más comprobantes.',
      );
    }
    if (TERMINAL_PAYMENT_STATES.includes(payment.state as string)) {
      throw new VendixHttpException(
        ErrorCodes.PAY_VALIDATE_001,
        'Este pago ya quedó resuelto y no necesita comprobante.',
      );
    }

    const methodType =
      payment.store_payment_method?.system_payment_method?.type ?? null;
    if (methodType !== 'bank_transfer' && methodType !== 'voucher') {
      throw new VendixHttpException(
        ErrorCodes.PAY_VALIDATE_001,
        'Este medio de pago no recibe comprobante. Solo transferencia y datáfono lo permiten.',
      );
    }

    if (!file || !file.buffer?.length) {
      throw new VendixHttpException(
        ErrorCodes.PAY_VALIDATE_001,
        'Adjunta el comprobante de tu transferencia (imagen o PDF, máximo 5 MB).',
      );
    }

    if (
      !file.mimetype ||
      !InvoiceDataRequestsService.RECEIPT_ALLOWED_MIME_TYPES.includes(
        file.mimetype,
      )
    ) {
      throw new VendixHttpException(ErrorCodes.VALIDATION_FILE_TYPE);
    }

    if (file.size > InvoiceDataRequestsService.RECEIPT_MAX_BYTES) {
      throw new PayloadTooLargeException(
        'El comprobante supera los 5 MB. Comprime la imagen o el PDF e inténtalo de nuevo.',
      );
    }

    const key = await this.uploadGuestReceipt(file, request.store_id);
    const receipt_uploaded_at = new Date();
    // `payments` SÍ está scopeado en `StorePrismaService`, pero el update va
    // por PK + `order_id` del binding: aunque el scope aporte el filtro de
    // tienda, el vínculo token→orden→pago ya quedó verificado arriba y la
    // fila solo se toca si pertenece a esta orden.
    const persisted = await this.prisma.payments.updateMany({
      where: { id: payment.id, order_id: request.order_id },
      data: { receipt_s3_key: key, receipt_uploaded_at },
    });

    // R8-F4 — `count === 0` (carrera: el pago se borró tras el binding) no
    // es éxito: se purga el objeto recién subido para no dejar un huérfano
    // en S3 y se responde el mismo 404 ciego del binding.
    if (persisted.count === 0) {
      try {
        await this.s3Service.deleteFile(key);
      } catch (cleanupError) {
        this.logger.warn(
          `Orphan receipt cleanup failed for key ${key}: ${(cleanupError as Error)?.message}`,
        );
      }
      throw new VendixHttpException(ErrorCodes.PAY_FIND_001);
    }

    return {
      payment_id: payment.id,
      has_receipt: true,
      receipt_content_type: file.mimetype,
      receipt_uploaded_at,
    };
  }

  /**
   * Clon de `CheckoutService.uploadCheckoutReceipt` con la tienda tomada del
   * binding (orden del token), no del contexto: el guest no tiene tienda en
   * ALS. Misma key `.../receipts/{YYYY}/{MM}/{uuid}-{sanitized}`.
   */
  private async uploadGuestReceipt(
    file: Express.Multer.File,
    storeId: number,
  ): Promise<string> {
    // `stores`/`organizations` son getters globales (sin scope): el filtro
    // por id tiene que ser explícito (misma nota que en checkout).
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { id: true, slug: true, organization_id: true },
    });
    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    const organization = await this.prisma.organizations.findUnique({
      where: { id: store.organization_id },
      select: { id: true, slug: true },
    });
    if (!organization) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
    }

    const basePath = this.receiptPaths.buildReceiptPath(
      { id: organization.id, slug: organization.slug },
      { id: store.id, slug: store.slug },
    );

    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    const safeFilename = this.sanitizeReceiptFilename(file.originalname);
    const key = `${basePath}/${year}/${month}/${crypto.randomUUID()}-${safeFilename}`;

    await this.s3Service.uploadFile(file.buffer, key, file.mimetype);
    return key;
  }

  /**
   * Clon de `CheckoutService.sanitizeReceiptFilename`: solo
   * `[a-zA-Z0-9._-]`, resto a `_`; vacío ⇒ `receipt`.
   */
  private sanitizeReceiptFilename(name: string | undefined | null): string {
    const base = (name ?? '').split(/[\\/]/).pop() ?? '';
    const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    return sanitized.length > 0 ? sanitized : 'receipt';
  }

  /**
   * Submit billing data from the public form.
   * Saves the data and marks status as 'submitted'.
   * Processing (credit note + new invoice) will be handled separately.
   */
  async submitData(token: string, dto: SubmitInvoiceDataDto) {
    const request = await this.prisma.invoice_data_requests.findUnique({
      where: { token },
    });

    if (!request) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DATA_REQUEST_002,
        'El enlace para solicitar tu factura no es válido. Pídele a la tienda uno nuevo.',
      );
    }

    if (request.status !== 'pending') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DATA_REQUEST_004,
        'Este enlace ya recibió tus datos. La tienda está emitiendo tu factura.',
      );
    }

    if (request.expires_at < new Date()) {
      // Auto-expire
      await this.prisma.invoice_data_requests.update({
        where: { id: request.id },
        data: { status: 'expired', updated_at: new Date() },
      });
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DATA_REQUEST_003,
        'El enlace para solicitar tu factura venció. Pídele a la tienda uno nuevo.',
      );
    }

    const updated = await this.prisma.invoice_data_requests.update({
      where: { id: request.id },
      data: {
        first_name: dto.first_name,
        last_name: dto.last_name,
        document_type: dto.document_type,
        document_number: dto.document_number,
        email: dto.email,
        phone: dto.phone,
        status: 'submitted',
        submitted_at: new Date(),
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('invoice_data_request.submitted', {
      store_id: updated.store_id,
      request_id: updated.id,
      order_id: updated.order_id,
      token: updated.token,
      status: 'submitted',
      customer_name: `${dto.first_name} ${dto.last_name}`,
      document_number: dto.document_number,
    } as InvoiceDataRequestEvent);

    this.logger.log(`Invoice data submitted for request #${updated.id}`);

    return updated;
  }

  /**
   * Predicado de búsqueda del listado admin.
   *
   * `order.order_number` va por la relación y no por una columna propia porque
   * la solicitud sólo guarda `order_id`: buscar «FV-1043» sobre las columnas de
   * `invoice_data_requests` no encuentra nada, que es exactamente lo que el
   * comerciante escribe. Los cuatro campos restantes son los que el cliente
   * escribió en el formulario público.
   */
  private buildRequestSearchFilter(
    search?: string,
  ): Prisma.invoice_data_requestsWhereInput[] {
    const term = search?.trim();
    if (!term) {
      return [];
    }
    const contains = { contains: term, mode: 'insensitive' as const };
    return [
      {
        OR: [
          { first_name: contains },
          { last_name: contains },
          { document_number: contains },
          { email: contains },
          { order: { order_number: contains } },
        ],
      },
    ];
  }

  /**
   * Listado admin paginado de solicitudes de factura a nombre del cliente.
   *
   * Devolvía `findMany` sin cota: una tienda con un año de ventas a consumidor
   * final materializaba la tabla entera —con el `include` de órdenes— en cada
   * apertura de la pestaña. Ahora pagina y devuelve el `total` que el
   * `app-pagination` necesita para saber cuántas páginas hay.
   */
  async findByStore(
    storeId: number,
    query: QueryInvoiceDataRequestsDto = {},
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));

    const where: Prisma.invoice_data_requestsWhereInput = {
      store_id: storeId,
      ...(query.status ? { status: query.status } : {}),
      ...(this.buildRequestSearchFilter(query.search).length
        ? { AND: this.buildRequestSearchFilter(query.search) }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.invoice_data_requests.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              order_number: true,
              grand_total: true,
              created_at: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice_data_requests.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Conteo por estado para las tarjetas del listado.
   *
   * NO acepta `status`: las tarjetas son el mapa completo de la pestaña y a la
   * vez el atajo para filtrar por cada estado. Si el conteo respetara el filtro
   * activo, al elegir «Falló la conversión» las otras cinco tarjetas caerían a
   * cero y el comerciante perdería la única vista que le dice cuántas
   * solicitudes están esperando en los demás estados. `search` sí se respeta,
   * porque ahí el usuario está acotando el universo, no mirando una rebanada.
   *
   * Los seis estados se siembran en cero antes del `groupBy`: Prisma sólo
   * devuelve filas para los estados presentes, y una tarjeta que desaparece
   * cuando su conteo es cero hace que el bloque cambie de tamaño al filtrar.
   */
  async summaryByStore(
    storeId: number,
    search?: string,
  ): Promise<Record<string, number> & { total: number }> {
    const where: Prisma.invoice_data_requestsWhereInput = {
      store_id: storeId,
      ...(this.buildRequestSearchFilter(search).length
        ? { AND: this.buildRequestSearchFilter(search) }
        : {}),
    };

    const grouped = await this.prisma.invoice_data_requests.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const summary = INVOICE_DATA_REQUEST_STATUSES.reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as Record<string, number>,
    );

    let total = 0;
    for (const row of grouped) {
      const count = row._count?._all ?? 0;
      summary[row.status] = count;
      total += count;
    }

    return { ...summary, total };
  }

  /**
   * Process a submitted invoice data request:
   * 1. Find or create customer
   * 2. Generate credit note for the CF invoice (if exists)
   * 3. Create new nominative invoice
   * 4. Mark request as completed
   */
  async processRequest(requestId: number, storeId: number) {
    const request = await this.prisma.invoice_data_requests.findFirst({
      where: { id: requestId, store_id: storeId, status: 'submitted' },
      include: {
        order: {
          include: {
            // [resid-fiscal] — `processRequest` arma el payload que dispara
            // la emisión DIAN; cualquier cancelado se vuelve línea
            // legalmente emitida. Filtramos antes del map a líneas.
            order_items: { where: { cancelled_at: null } },
            stores: true,
          },
        },
      },
    });

    if (!request) {
      // Un identificador en MAYÚSCULAS_CON_GUIONES no es un mensaje: sin
      // `error_code` el frontend no tiene catálogo al que ir y le pinta al
      // comerciante el nombre literal de la constante.
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DATA_REQUEST_001,
        'La solicitud ya no está pendiente de procesar. Actualiza la lista para ver en qué estado quedó.',
        { request_id: requestId },
      );
    }

    // Mark as processing with a compare-and-swap guard: only the worker that
    // flips 'submitted' -> 'processing' may continue. Another worker (event
    // listener vs. admin endpoint) racing on the same request aborts silently.
    const claimed = await this.prisma.invoice_data_requests.updateMany({
      where: { id: requestId, status: 'submitted' },
      data: { status: 'processing', updated_at: new Date() },
    });

    if (claimed.count === 0) {
      this.logger.log(
        `Invoice data request #${requestId} already claimed by another worker; skipping.`,
      );
      return null;
    }

    try {
      const order = request.order;
      const organizationId = order.stores?.organization_id;

      if (!organizationId) {
        throw new Error('Organization not found for store');
      }

      // 1. Find or create customer in the organization
      let customer = await this.prisma.users.findFirst({
        where: {
          document_number: {
            equals: request.document_number,
            mode: 'insensitive',
          },
          organization_id: organizationId,
          user_roles: { some: { roles: { name: 'customer' } } },
        },
      });

      if (!customer) {
        // Find customer role
        const customerRole = await this.prisma.roles.findFirst({
          where: { name: 'customer', organization_id: null, is_system_role: true },
        });

        if (!customerRole) {
          throw new Error('Customer role not found');
        }

        // Create a minimal user for invoicing purposes
        const username = `inv_${request.document_number}_${Date.now()}`;
        const bcrypt = await import('bcrypt');
        const hashedPassword = await bcrypt.hash(username, 12);

        customer = await this.prisma.users.create({
          data: {
            email:
              request.email ||
              `invoice_${request.token}@placeholder.vendix.com`,
            password: hashedPassword,
            first_name: request.first_name || '',
            last_name: request.last_name || '',
            phone: request.phone,
            document_type: request.document_type as any,
            document_number: request.document_number,
            username,
            email_verified: false,
            organization_id: organizationId,
            user_roles: {
              create: { role_id: customerRole.id },
            },
            store_users: {
              create: { store_id: storeId },
            },
          },
        });
      }

      // 2. Link customer to order (update order with customer_id)
      // QUI-727 (A.3 / ADR-9): al fijar customer_id garantizamos customer_alias
      // NULL — el CHECK orders_customer_xor_alias rechaza ambos poblados.
      await this.prisma.orders.update({
        where: { id: order.id },
        data: {
          customer_id: customer.id,
          customer_alias: null,
          updated_at: new Date(),
        },
      });

      // 3. Convert the linked fiscal document(s) to a nominative invoice.
      const conversion = await this.convertToNominativeInvoice({
        request,
        order,
        customerId: customer.id,
      });

      // The original invoice was already transmitted and is awaiting the DIAN
      // response: it can be neither mutated nor credited yet. Revert the
      // request to 'submitted' so it can be reprocessed later (admin endpoint).
      if (conversion.strategy === 'deferred') {
        const deferred = await this.prisma.invoice_data_requests.update({
          where: { id: requestId },
          data: { status: 'submitted', updated_at: new Date() },
        });

        this.logger.log(
          `Invoice data request #${requestId} deferred: original invoice for order #${order.id} is awaiting DIAN response.`,
        );

        return deferred;
      }

      // 4. Mark as completed
      const completed = await this.prisma.invoice_data_requests.update({
        where: { id: requestId },
        data: {
          status: 'completed',
          processed_at: new Date(),
          new_invoice_id: conversion.new_invoice_id,
          updated_at: new Date(),
        },
      });

      this.logger.log(
        `Invoice data request #${requestId} converted via '${conversion.strategy}' (new_invoice_id: ${conversion.new_invoice_id}, credit_note_id: ${conversion.credit_note_id})`,
      );

      this.eventEmitter.emit('invoice_data_request.completed', {
        store_id: storeId,
        request_id: requestId,
        order_id: order.id,
        token: request.token,
        status: 'completed',
        customer_name: `${request.first_name} ${request.last_name}`,
        document_number: request.document_number,
      } as InvoiceDataRequestEvent);

      this.logger.log(
        `Invoice data request #${requestId} processed successfully`,
      );

      return completed;
    } catch (error) {
      // Mark as failed
      await this.prisma.invoice_data_requests.update({
        where: { id: requestId },
        data: { status: 'failed', updated_at: new Date() },
      });

      this.logger.error(
        `Failed to process invoice data request #${requestId}: ${error.message}`,
        error.stack,
      );

      throw error;
    }
  }

  /**
   * Convert the order's fiscal documents into a nominative invoice.
   *
   * Decision tree by status of the original invoice linked to the order:
   * - none                       -> issue new nominative invoice ('issued_new')
   * - draft/validated (no CUFE)  -> update customer data in place ('updated_in_place')
   * - sent (awaiting DIAN)       -> defer, nothing can be mutated yet ('deferred')
   * - accepted (CUFE, immutable) -> full mirror credit note + new invoice ('credit_note_reissue')
   * - rejected/cancelled/voided  -> issue new invoice, no credit note ('issued_new')
   */
  private async convertToNominativeInvoice(params: {
    request: {
      id: number;
      invoice_id: number | null;
      first_name: string | null;
      last_name: string | null;
      document_number: string | null;
    };
    order: { id: number };
    customerId: number;
  }): Promise<NominativeConversionResult> {
    const { request, order, customerId } = params;

    const originalInvoice = request.invoice_id
      ? await this.prisma.invoices.findFirst({
          where: { id: request.invoice_id },
          include: { invoice_items: true, invoice_taxes: true },
        })
      : await this.prisma.invoices.findFirst({
          where: { order_id: order.id, invoice_type: 'sales_invoice' },
          include: { invoice_items: true, invoice_taxes: true },
          orderBy: { created_at: 'desc' },
        });

    if (!originalInvoice) {
      const new_invoice_id = await this.issueNominativeInvoice(order.id);
      return { new_invoice_id, credit_note_id: null, strategy: 'issued_new' };
    }

    switch (originalInvoice.status) {
      case 'draft':
      case 'validated': {
        // Not yet transmitted (no CUFE): the customer data can be fixed in place.
        await this.prisma.invoices.update({
          where: { id: originalInvoice.id },
          data: {
            customer_id: customerId,
            customer_name: `${request.first_name} ${request.last_name}`,
            customer_tax_id: request.document_number,
            updated_at: new Date(),
          },
        });

        this.logger.log(
          `Updated invoice #${originalInvoice.id} in place with customer data for request #${request.id}`,
        );

        return {
          new_invoice_id: originalInvoice.id,
          credit_note_id: null,
          strategy: 'updated_in_place',
        };
      }

      case 'sent':
        // Awaiting DIAN response: cannot mutate nor void until resolved.
        return {
          new_invoice_id: null,
          credit_note_id: null,
          strategy: 'deferred',
        };

      case 'accepted': {
        // Accepted by DIAN (has CUFE): immutable. Issue a full mirror credit
        // note and a new nominative invoice.
        const credit_note_id =
          await this.issueMirrorCreditNote(originalInvoice);
        const new_invoice_id = await this.issueNominativeInvoice(order.id);

        return {
          new_invoice_id,
          credit_note_id,
          strategy: 'credit_note_reissue',
        };
      }

      // rejected / cancelled / voided: original has no fiscal effect, issue a
      // new nominative invoice without a credit note.
      default: {
        const new_invoice_id = await this.issueNominativeInvoice(order.id);
        return {
          new_invoice_id,
          credit_note_id: null,
          strategy: 'issued_new',
        };
      }
    }
  }

  /**
   * Issue a new nominative sales invoice from the order. `createFromOrder`
   * already reads the latest invoice_data_request of the order to nominate the
   * customer. Transmission to DIAN is best-effort.
   */
  private async issueNominativeInvoice(orderId: number): Promise<number> {
    const invoice = await this.invoicingService.createFromOrder(orderId);
    await this.invoiceFlowService.validate(invoice.id);
    await this.sendBestEffort(invoice.id, 'nominative invoice');
    return invoice.id;
  }

  /**
   * Issue a full reversal credit note mirroring the original accepted invoice
   * (same items and taxes). Transmission to DIAN is best-effort.
   */
  private async issueMirrorCreditNote(originalInvoice: {
    id: number;
    currency: string | null;
    invoice_items: Array<{
      product_id: number | null;
      product_variant_id: number | null;
      description: string;
      quantity: Prisma.Decimal;
      unit_price: Prisma.Decimal;
      discount_amount: Prisma.Decimal | null;
      tax_amount: Prisma.Decimal | null;
    }>;
    invoice_taxes: Array<{
      tax_rate_id: number | null;
      tax_name: string;
      tax_rate: Prisma.Decimal;
      taxable_amount: Prisma.Decimal;
      tax_amount: Prisma.Decimal;
      tax_type: string | null;
    }>;
  }): Promise<number> {
    const dto: CreateCreditNoteDto = {
      related_invoice_id: originalInvoice.id,
      reason: 'Conversión a factura nominativa por solicitud del cliente',
      // Fiscal day, not UTC day: between 00:00 and 05:00 Colombia the UTC date
      // is already tomorrow, which would date the credit note into a period the
      // original invoice does not belong to. DIAN only accepts Colombian
      // emitters, so the emitter's fiscal day is always Bogotá's.
      issue_date: localDateString(new Date(), DEFAULT_STORE_TIMEZONE),
      currency: originalInvoice.currency || undefined,
      items: (originalInvoice.invoice_items || []).map((item) => ({
        product_id: item.product_id ?? undefined,
        product_variant_id: item.product_variant_id ?? undefined,
        description: item.description,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        discount_amount: Number(item.discount_amount || 0),
        tax_amount: Number(item.tax_amount || 0),
      })),
      taxes: (originalInvoice.invoice_taxes || []).map((tax) => ({
        tax_rate_id: tax.tax_rate_id ?? undefined,
        tax_name: tax.tax_name,
        tax_rate: Number(tax.tax_rate),
        taxable_amount: Number(tax.taxable_amount),
        tax_amount: Number(tax.tax_amount),
        tax_type: (tax.tax_type ??
          undefined) as CreateInvoiceTaxDto['tax_type'],
      })),
    };

    const note = await this.creditNotesService.createCreditNote(dto);
    await this.invoiceFlowService.validate(note.id);
    await this.sendBestEffort(note.id, 'mirror credit note');

    this.logger.log(
      `Mirror credit note #${note.id} created for accepted invoice #${originalInvoice.id}`,
    );

    return note.id;
  }

  /**
   * Best-effort DIAN transmission: if the provider fails, the document stays
   * in 'validated' and the existing retry queue picks it up later. The data
   * request must never fail because of a transient DIAN outage.
   */
  private async sendBestEffort(
    invoiceId: number,
    label: string,
  ): Promise<void> {
    try {
      await this.invoiceFlowService.send(invoiceId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      this.logger.warn(
        `Best-effort DIAN transmission failed for ${label} #${invoiceId}: ${message}. Document stays 'validated'; the retry queue will pick it up.`,
      );
    }
  }
}
