import {
  Injectable,
  Logger,
  PayloadTooLargeException,
  Optional,
} from '@nestjs/common';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  InvoiceHolderLinkService,
  HolderLinkBinding,
} from '../invoice-holder-changes/invoice-holder-link.service';
import { InvoiceHolderChangesService } from '../invoice-holder-changes/invoice-holder-changes.service';
import { GuestOrderAccessService } from '@common/context/guest-order-access.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { CustomerFiscalIdentityValidator } from '../validators/customer-fiscal-identity.validator';
import { DianMunicipalitiesService } from '../../addresses/dian-municipalities.service';
import { computeNitDv } from '@common/utils/nit.util';
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
import { InvoicingService } from '../invoicing.service';
import { CreditNotesService } from '../credit-notes/credit-notes.service';
import { InvoiceFlowService } from '../invoice-flow/invoice-flow.service';
// C.7 (CP-pos-exclusive-tax-double-charge, ADR-12) — mismo resolvedor que usan
// los providers del gateway de impresión para las superficies `@OptionalAuth`.
import { resolvePrintsVatBreakdownForPrint } from '../../print-formats/services/print-vat-breakdown.resolver';
import { normalizeNit } from '@common/utils/nit.util';
// Plan order-truth-and-invoice-tz (Step 6) — writer único de order_events.
import { OrderHistoryService } from '../../orders/order-history/order-history.service';

/**
 * Paso 6 (roku-shop-checkout-tarifa-detalle-orden) — binding liviano
 * token→orden para el stream SSE guest. Ambos ids se derivan SERVER-SIDE
 * del token; el controller los usa como clave default-deny del filtro.
 */
export interface GuestStreamBinding {
  order_id: number;
  store_id: number;
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
    // Plan order-truth-and-invoice-tz (Step 6) — writer único de order_events.
    // Sin ciclo: OrderHistoryModule solo importa PrismaModule.
    private readonly orderHistory: OrderHistoryService,
    @Optional() private readonly holderLinks?: InvoiceHolderLinkService,
    @Optional() private readonly guestAccess?: GuestOrderAccessService,
    @Optional() private readonly contextRunner?: StoreContextRunner,
    @Optional() private readonly holderChanges?: InvoiceHolderChangesService,
    @Optional() private readonly municipalities?: DianMunicipalitiesService,
  ) {}

  // `S3PathHelper` es stateless (sin constructor): se instancia directo en
  // vez de inyectarlo para NO cambiar la aridad del constructor — el spec
  // existente construye el servicio con 6 args y `buildcheck:types` (CI)
  // tipa los specs. La key sigue centralizada en el helper (skill
  // vendix-s3-storage), solo cambia cómo se obtiene.
  private readonly receiptPaths = new S3PathHelper();

  /** Only explicit opening materializes demand. Generation, guest and status never call this. */
  private async resolveRequest(token: string, create: boolean, adopt = false) {
    const binding = await this.holderLinks!.resolveToken(token, 'status');
    return this.contextRunner!.runInStoreContext(binding.store_id, async () => {
      const request = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT o.id FROM orders o JOIN stores s ON s.id=o.store_id
          WHERE o.id=${binding.order_id} AND o.store_id=${binding.store_id}
            AND s.organization_id=${binding.organization_id} FOR UPDATE OF o`);
          if (locked.length !== 1)
            throw new VendixHttpException(
              ErrorCodes.INVOICING_DATA_REQUEST_002,
            );
          const operation = await tx.invoice_holder_changes.findFirst({
            where: {
              store_id: binding.store_id,
              organization_id: binding.organization_id,
              original_invoice_id: binding.invoice_id,
              original_order_id: binding.order_id,
            },
          });
          const candidates = await tx.invoice_data_requests.findMany({
            where: {
              store_id: binding.store_id,
              order_id: binding.order_id,
              OR: [
                { invoice_id: binding.invoice_id },
                ...(binding.legacy_request_id
                  ? [{ id: binding.legacy_request_id }]
                  : []),
              ],
            },
            orderBy: [{ submitted_at: 'asc' }, { id: 'asc' }],
          });
          const documents = new Set(
            candidates
              .filter((r) => r.new_invoice_id)
              .map((r) => r.new_invoice_id),
          );
          if (documents.size > 1)
            throw new VendixHttpException(
              ErrorCodes.CF_HOLDER_LEGACY_REVIEW_REQUIRED,
              'La tienda debe revisar las solicitudes anteriores.',
            );
          const sent = candidates.filter(
            (r) =>
              r.submitted_at ||
              ['submitted', 'processing', 'completed', 'failed'].includes(
                r.status,
              ),
          );
          let canonical =
            (operation?.request_id
              ? candidates.find((r) => r.id === operation.request_id)
              : null) ??
            sent[0] ??
            candidates.find(
              (r) => r.status === 'pending' && r.expires_at > new Date(),
            ) ??
            null;
          if (!create || (canonical && !adopt)) return { binding, request: canonical, operation };
          if (operation) return { binding, request: canonical, operation };
          if (!this.holderLinks!.isAdmissionEnabled(binding.store_id))
            throw new VendixHttpException(
              ErrorCodes.CF_HOLDER_INELIGIBLE,
              'Las nuevas solicitudes no están habilitadas.',
            );
          // Revalidate under the same row lock used by fiscal/split/refund writers.
          const verified = await this.holderLinks!.resolveToken(token);
          if (verified.invoice_id !== binding.invoice_id)
            throw new VendixHttpException(
              ErrorCodes.INVOICING_DATA_REQUEST_002,
            );
          const key = `${binding.store_id}:${binding.invoice_id}`;
          if (
            canonical &&
            candidates.some(
              (r) => r.active_invoice_key === key && r.id !== canonical!.id,
            )
          )
            throw new VendixHttpException(
              ErrorCodes.CF_HOLDER_LEGACY_REVIEW_REQUIRED,
              'Hay solicitudes anteriores que requieren revisión.',
            );
          if (!canonical)
            canonical = await tx.invoice_data_requests.create({
              data: {
                store_id: binding.store_id,
                order_id: binding.order_id,
                invoice_id: binding.invoice_id,
                token: uuidv4(),
                origin: 'public_link',
                opened_at: new Date(),
                active_invoice_key: key,
                status: 'pending',
                expires_at: binding.expires_at,
              },
            });
          else if (!canonical.opened_at || !canonical.active_invoice_key) {
            await tx.invoice_data_requests.updateMany({
              where: {
                id: canonical.id,
                store_id: binding.store_id,
                order_id: binding.order_id,
              },
              data: {
                opened_at: canonical.opened_at ?? new Date(),
                active_invoice_key: key,
                invoice_id: binding.invoice_id,
              },
            });
            canonical = {
              ...canonical,
              opened_at: canonical.opened_at ?? new Date(),
              active_invoice_key: key,
              invoice_id: binding.invoice_id,
            };
          }
          return { binding, request: canonical, operation };
        },
      );
      return request;
    });
  }
  private publicProgress(
    request: {
      status: string;
      id: number;
      new_invoice_id: number | null;
    } | null,
    operation: {
      id: number;
      phase: string;
      run_status: string;
      new_invoice_id: number | null;
      last_error_code?: string | null;
    } | null,
  ) {
    const completed = operation
      ? operation.run_status === 'completed' ||
        ['fiscal_completed', 'completed'].includes(operation.phase)
      : request?.status === 'completed';
    return {
      request_id: request?.id ?? null,
      status: completed ? 'completed' : (request?.status ?? 'not_opened'),
      operation_id: operation?.id ?? null,
      phase: operation?.phase ?? 'pending',
      run_status: operation?.run_status ?? 'ready',
      can_retry: operation?.run_status === 'retryable_error',
      new_invoice_id:
        operation?.new_invoice_id ?? request?.new_invoice_id ?? null,
      message: completed
        ? 'Factura ya emitida.'
        : 'Datos recibidos; la emisión solo se confirma después de la aceptación de la DIAN.',
    };
  }
  async getStatus(token: string) {
    const { request, operation } = await this.resolveRequest(token, false);
    return this.publicProgress(request, operation);
  }
  async validatePublicToken(token: string): Promise<HolderLinkBinding> {
    return this.holderLinks!.resolveToken(token);
  }
  async getByToken(token: string) {
    const { binding, request, operation } = await this.resolveRequest(
      token,
      true,
    );
    return this.contextRunner!.runInStoreContext(binding.store_id, async () => {
      const [order, store] = await Promise.all([
        this.prisma.orders.findFirst({
          where: { id: binding.order_id, store_id: binding.store_id },
          select: {
            id: true,
            order_number: true,
            grand_total: true,
            created_at: true,
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
        }),
        this.prisma.stores.findFirst({
          where: {
            id: binding.store_id,
            organization_id: binding.organization_id,
          },
          select: { id: true, name: true, logo_url: true },
        }),
      ]);
      return {
        ...this.publicProgress(request, operation),
        id: request?.id ?? null,
        expires_at: binding.expires_at,
        order,
        store,
        capabilities: {
          can_submit: request?.status === 'pending' && !operation && this.holderLinks!.isAdmissionEnabled(binding.store_id),
          can_retry: operation?.run_status === 'retryable_error',
        },
      };
    });
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
    const lineUnits =
      Number(item.price_unit_quantity ?? item.quantity ?? 1) || 1;
    const grossUnit =
      item.final_unit_price != null
        ? Number(item.final_unit_price)
        : netUnit + Number(item.tax_amount_item ?? 0) / lineUnits;
    const multiplier =
      netUnit !== 0 ? netTotal / netUnit : Number(item.quantity ?? 0);
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
    const binding = await this.guestAccess!.resolve(token);
    if (!binding)
      throw new VendixHttpException(ErrorCodes.INVOICING_DATA_REQUEST_002);
    return this.contextRunner!.runInStoreContext(binding.store_id, () =>
      this.buildGuestOrderSummary(token, binding),
    );
  }
  private async buildGuestOrderSummary(
    token: string,
    binding: { order_id: number; store_id: number },
  ) {
    const order = await this.prisma.orders.findFirst({
      where: { id: binding.order_id, store_id: binding.store_id },
      include: {
        // [resid-fiscal] — Mismo filtro que arriba: el summary va a
        // la página pública del cliente. Si quedara un cancelado,
        // vería una línea con `total_price` que el total agregado
        // ya no suma — inconsistencia visible.
        order_items: {
          where: { cancelled_at: null },
          select: {
            // CP-853-fix (paso 5): clave por línea para la cocina guest.
            id: true,
            product_name: true,
            variant_sku: true,
            variant_attributes: true,
            variant_image_url: true,
            // Nota que el propio comprador escribio para la linea.
            notes: true,
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
        stores: {
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
        users: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
          },
        },
      },
    });
    const request = order
      ? {
          order,
          store: order.stores,
          token,
          status: null,
          expires_at: null,
          first_name: order.users?.first_name ?? order.customer_alias ?? null,
          last_name: order.users?.last_name ?? null,
          email: order.users?.email ?? null,
          phone: order.users?.phone ?? null,
          document_type: null,
          document_number: null,
        }
      : null;

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
        // CP-853-fix (paso 5): clave por línea para la cocina guest — dos
        // líneas del mismo producto ya no comparten estado. Aditivo.
        order_item_id: item.id,
        product_name: item.product_name,
        variant_sku: item.variant_sku,
        variant_attributes: item.variant_attributes,
        notes: item.notes ?? null,
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
          ? await this.s3Service.signUrl(
              item.products.product_images[0].image_url,
            )
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
          ...items.map((item) => item.preparation_time_minutes ?? defaultPrep),
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

    const holderLink = request.order.invoices[0]
      ? await this.holderLinks!.getLinkForInvoice(
          request.order.invoices[0].id,
          binding.store_id,
        )
      : null;
    return {
      invoice_data_token: holderLink?.token ?? null,
      invoice_data_url: holderLink?.url ?? null,
      invoice_data_expires_at: holderLink?.expires_at ?? null,
      token: request.token,
      invoice_data_status: request.status,
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
    const binding = await this.guestAccess!.resolve(token);
    if (!binding)
      throw new VendixHttpException(ErrorCodes.INVOICING_DATA_REQUEST_002);
    const order = await this.contextRunner!.runInStoreContext(
      binding.store_id,
      async () =>
        this.prisma.orders.findFirst({
          where: { id: binding.order_id, store_id: binding.store_id },
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
        }),
    );
    const request = order ? { ...binding, order } : null;

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
    return this.guestAccess!.resolve(token);
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

    const TTL_SECONDS = InvoiceDataRequestsService.RECEIPT_URL_TTL_SECONDS;
    const [url, head] = await Promise.all([
      this.s3Service.getPresignedUrl(payment.receipt_s3_key, TTL_SECONDS),
      this.s3Service.headObject(payment.receipt_s3_key),
    ]);
    const expires_at = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();

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
    const TERMINAL_ORDER_STATES = [
      'cancelled',
      'refunded',
      'finished',
      'delivered',
    ];
    const TERMINAL_PAYMENT_STATES = [
      'succeeded',
      'captured',
      'refunded',
      'cancelled',
    ];
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
    const persisted = await this.contextRunner!.runInStoreContext<Prisma.BatchPayload>(
      request.store_id,
      () =>
        this.prisma.payments.updateMany({
          where: {
            id: payment.id,
            order_id: request.order_id,
            orders: { store_id: request.store_id },
          },
          data: { receipt_s3_key: key, receipt_uploaded_at },
        }),
    );

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
    this.validateCapture(dto);
    const snapshot = this.normalizeCapture(dto);
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');
    const { binding, request } = await this.resolveRequest(token, true, true);
    if (!request)
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_SUBMISSION_CONFLICT,
        'Esta factura ya tiene un cambio de titular en curso.',
      );
    return this.contextRunner!.runInStoreContext(binding.store_id, async () => {
      const operation = await this.holderChanges!.startPublic(
        request.id,
        binding.store_id,
        snapshot,
        hash,
      );
      // Durable operation owns the capture/hash and all irreversible fiscal effects.
      return this.publicProgress(
        {
          ...request,
          status:
            operation.run_status === 'completed' ? 'completed' : 'processing',
        },
        operation,
      );
    });
  }
  private normalizeCapture(dto: SubmitInvoiceDataDto) {
    const document =
      dto.document_type === 'NIT'
        ? normalizeNit(dto.document_number).number
        : dto.document_number.trim();
    return {
      person_type: dto.person_type,
      document_type: dto.document_type,
      document_number: document,
      verification_digit:
        dto.document_type === 'NIT' ? computeNitDv(document) : undefined,
      first_name:
        dto.person_type === 'NATURAL' ? dto.first_name?.trim() : undefined,
      last_name:
        dto.person_type === 'NATURAL' ? dto.last_name?.trim() : undefined,
      legal_name:
        dto.person_type === 'JURIDICA' ? dto.legal_name?.trim() : undefined,
      email: dto.email.trim().toLowerCase(),
      phone: dto.phone?.trim() || undefined,
      address: {
        address_line1: dto.address.address_line1.trim(),
        city: dto.address.city.trim(),
        state_province: dto.address.state_province.trim(),
        country_code: dto.address.country_code,
        municipality_code: dto.address.municipality_code,
      },
    };
  }
  private validateCapture(dto: SubmitInvoiceDataDto) {
    const municipality = this.municipalities!.findByCode(
      dto.address?.municipality_code,
    );
    const report = new CustomerFiscalIdentityValidator().validate({
      ...dto,
      identification_mode: 'nominative',
      address: {
        address_line: dto.address?.address_line1,
        city_code: dto.address?.municipality_code,
        city_name: dto.address?.city,
        department_code: dto.address?.municipality_code?.slice(0, 2),
        department_name: dto.address?.state_province,
        country_code: dto.address?.country_code,
      },
      other_addresses: [],
    });
    if (
      !dto.email?.trim() ||
      !dto.address?.address_line1?.trim() ||
      !municipality ||
      dto.address.country_code !== 'CO' ||
      (dto.person_type === 'JURIDICA' && dto.document_type !== 'NIT') ||
      normalizeNit(dto.document_number).number === '222222222222' ||
      report.blockers.length
    )
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_CAPTURE_INVALID,
        'Completa los datos fiscales obligatorios y una dirección DANE válida.',
        { fields: report.blockers },
      );
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
          {
            invoice_holder_changes_request_id: {
              is: {
                customer_snapshot: {
                  path: ['legal_name'],
                  string_contains: term,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      },
    ];
  }

  private buildVisibilityFilter(
    storeId: number,
    query: QueryInvoiceDataRequestsDto,
  ): Prisma.invoice_data_requestsWhereInput {
    const now = new Date();
    const filters: Prisma.invoice_data_requestsWhereInput[] =
      this.buildRequestSearchFilter(query.search);
    switch (query.visibility ?? 'requested') {
      case 'requested':
        filters.push({
          status: { in: ['submitted', 'processing', 'completed', 'failed'] },
          OR: [
            { origin: 'public_link' },
            { submitted_at: { not: null } },
            { new_invoice_id: { not: null } },
          ],
        });
        break;
      case 'pending':
        filters.push({
          status: 'pending',
          expires_at: { gt: now },
          opened_at: { not: null },
        });
        break;
      case 'expired':
        filters.push({
          OR: [
            { status: 'expired' },
            { status: 'pending', expires_at: { lte: now } },
          ],
        });
        break;
      case 'historical':
        filters.push({ origin: null, opened_at: null });
        break;
    }
    if (query.status === 'expired')
      filters.push({
        OR: [
          { status: 'expired' },
          { status: 'pending', expires_at: { lte: now } },
        ],
      });
    else if (query.status === 'pending')
      filters.push({ status: 'pending', expires_at: { gt: now } });
    else if (query.status) filters.push({ status: query.status });
    return { store_id: storeId, ...(filters.length ? { AND: filters } : {}) };
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

    const where = this.buildVisibilityFilter(storeId, query);

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

    const operations = await this.prisma.invoice_holder_changes.findMany({
      where: { store_id: storeId, request_id: { in: data.map((r) => r.id) } },
      select: {
        id: true,
        request_id: true,
        phase: true,
        run_status: true,
        last_error_message: true,
        credit_note_id: true,
        new_invoice_id: true,
        customer_snapshot: true,
      },
    });
    const projected = data.map(({ token: _token, ...row }) => {
      const op = operations.find((o) => o.request_id === row.id);
      return {
        ...row,
        status:
          row.status === 'pending' && row.expires_at <= new Date()
            ? 'expired'
            : row.status,
        legal_name:
          op?.customer_snapshot &&
          typeof op.customer_snapshot === 'object' &&
          !Array.isArray(op.customer_snapshot) &&
          typeof op.customer_snapshot.legal_name === 'string'
            ? op.customer_snapshot.legal_name
            : null,
        operation_id: op?.id ?? null,
        phase: op?.phase ?? null,
        run_status: op?.run_status ?? null,
        can_retry: op?.run_status === 'retryable_error',
        last_error_message: op?.last_error_message ?? null,
        credit_note_id: op?.credit_note_id ?? null,
        new_invoice_id: op?.new_invoice_id ?? row.new_invoice_id,
      };
    });
    return { data: projected, total, page, limit };
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
    visibility?: QueryInvoiceDataRequestsDto['visibility'],
  ): Promise<Record<string, number> & { total: number }> {
    const where = this.buildVisibilityFilter(storeId, { search, visibility });

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

    const effectiveExpired = await this.prisma.invoice_data_requests.count({
      where: {
        AND: [where, { status: 'pending', expires_at: { lte: new Date() } }],
      },
    });
    summary.pending -= effectiveExpired;
    summary.expired += effectiveExpired;
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
      where: { id: requestId, store_id: storeId },
    });
    if (!request)
      throw new VendixHttpException(ErrorCodes.INVOICING_DATA_REQUEST_002);
    const operation = await this.prisma.invoice_holder_changes.findFirst({
      where: { request_id: requestId, store_id: storeId },
    });
    if (!operation && request.status === 'submitted')
      return this.holderChanges!.adoptLegacySubmittedRequest(requestId);
    if (!operation)
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_LEGACY_REVIEW_REQUIRED,
        'La solicitud anterior necesita completar sus datos fiscales antes de continuar.',
      );
    return this.holderChanges!.resume(operation.id);
  }
}
