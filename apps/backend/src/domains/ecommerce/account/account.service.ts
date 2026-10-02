import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  CreateAddressDto,
  UpdateAddressDto,
} from './dto/account.dto';
import * as bcrypt from 'bcrypt';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { resolvePrintsVatBreakdownForPrint } from '../../store/print-formats/services/print-vat-breakdown.resolver';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  // `S3PathHelper` es stateless (sin constructor): se instancia directo.
  private readonly receiptPaths = new S3PathHelper();

  /**
   * Contrato de comprobante (espejo guest/checkout): MIME imagen/PDF,
   * 5 MB, URL firmada TTL 5 min para el visor.
   */
  private static readonly RECEIPT_ALLOWED_MIME_TYPES: readonly string[] = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];
  private static readonly RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
  private static readonly RECEIPT_URL_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async getProfile() {
    // user_id se obtiene del contexto del JWT
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;

    if (!user_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    const user = await this.prisma.users.findUnique({
      where: { id: user_id },
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        document_type: true,
        document_number: true,
        avatar_url: true,
        created_at: true,
        addresses: {
          orderBy: { is_primary: 'desc' },
        },
      },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.ECOM_ACCOUNT_001);
    }

    return user;
  }

  async updateProfile(dto: UpdateProfileDto) {
    // user_id se obtiene del contexto del JWT
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;

    if (!user_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    const user = await this.prisma.users.findUnique({
      where: { id: user_id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.ECOM_ACCOUNT_001);
    }

    return this.prisma.users.update({
      where: { id: user_id },
      data: {
        first_name: dto.first_name,
        last_name: dto.last_name,
        phone: dto.phone,
        document_type: dto.document_type as any,
        document_number: dto.document_number,
        avatar_url: dto.avatar_url,
        username: dto.username,
        updated_at: new Date(),
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        document_type: true,
        document_number: true,
        avatar_url: true,
        username: true,
      },
    });
  }

  async changePassword(dto: ChangePasswordDto) {
    // user_id se obtiene del contexto del JWT
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;

    if (!user_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    const user = await this.prisma.users.findUnique({
      where: { id: user_id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.ECOM_ACCOUNT_001);
    }

    const is_valid = await bcrypt.compare(dto.current_password, user.password);
    if (!is_valid) {
      throw new VendixHttpException(ErrorCodes.ECOM_ACCOUNT_002);
    }

    const hashed_password = await bcrypt.hash(dto.new_password, 12);

    await this.prisma.users.update({
      where: { id: user_id },
      data: { password: hashed_password, updated_at: new Date() },
    });

    return { message: 'Password changed successfully' };
  }

  async getOrders(page = 1, limit = 10) {
    // store_id y user_id se aplican automáticamente por EcommercePrismaService
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.orders.findMany({
        where: {}, // store_id y customer_id se aplican automáticamente
        skip,
        take: Number(limit),
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          order_number: true,
          state: true,
          grand_total: true,
          currency: true,
          created_at: true,
          placed_at: true,
          completed_at: true,
          // Pull the first order item's product name so the list view
          // can show "1 producto(s): <name>" instead of just the count.
          // We take 1 ordered by id asc to get a stable "first" item.
          order_items: {
            select: { product_name: true },
            take: 1,
            orderBy: { id: 'asc' },
          },
          _count: {
            select: { order_items: true },
          },
        },
      }),
      this.prisma.orders.count({
        where: {}, // store_id y customer_id se aplican automáticamente
      }),
    ]);

    return {
      data: data.map((order) => {
        const { order_items, _count, ...rest } = order;
        return {
          ...rest,
          item_count: _count.order_items,
          first_item_name: order_items?.[0]?.product_name ?? null,
        };
      }),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.ceil(total / Number(limit)),
      },
    };
  }

  /**
   * C.8 (R-1 / ADR-06) — deriva el bruto por línea en LECTURA, sin asumir
   * `final_unit_price` poblado: este endpoint (F-008) nunca importó
   * `resolveOrderLineFinals` ni escribió la columna, así que para pedidos de
   * checkout (`checkout.service.ts` nunca setea `final_unit_price`, F-005)
   * el fallback es el camino COMÚN, no la excepción. Fórmula exacta del
   * paso: `final_unit_price ?? (unit_price + COALESCE(tax_amount_item,0) /
   * line_units)`. `line_total_gross` usa el MISMO multiplicador que ya
   * relaciona `total_price` con `unit_price` en la fila persistida (en vez
   * de asumir `quantity` o `price_unit_quantity`), para no inventar una
   * tercera convención de escala en un archivo que no importa
   * `price-unit.util.ts`.
   */
  /**
   * Cocina por línea (paridad guest order-summary): devuelve el estado
   * in-flight (`pending`/`in_preparation`/`ready`) si hay alguno, si no el
   * más reciente. Null = la línea nunca se disparó a cocina.
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

  async getOrderDetail(order_id: number) {
    // store_id y user_id se aplican automáticamente por EcommercePrismaService
    const order = await this.prisma.orders.findFirst({
      where: {
        id: order_id,
        // store_id y customer_id se aplican automáticamente
      },
      include: {
        order_items: {
          include: {
            products: {
              include: {
                product_images: {
                  where: { is_main: true },
                  take: 1,
                },
              },
            },
            // Cocina en vivo + ETA variant-aware (paridad guest
            // order-summary): solo estado e id del ticket-item.
            kitchen_ticket_items: {
              orderBy: { id: 'desc' },
              select: { id: true, status: true },
            },
            product_variants: {
              select: { preparation_time_minutes: true },
            },
          },
        },
        payments: {
          include: {
            store_payment_method: {
              include: {
                system_payment_method: true,
              },
            },
          },
        },
        addresses_orders_shipping_address_idToaddresses: true,
        bookings: {
          include: { product: { select: { name: true } } },
          orderBy: { date: 'asc' },
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
        // Identidad de la tienda + insumos del gate fiscal C.7 (paridad
        // guest order-summary): nombre/logo del encabezado, settings para
        // el default de ETA y el gate de IVA.
        stores: {
          select: {
            id: true,
            name: true,
            logo_url: true,
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

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // ETA default de la tienda (paridad guest): default de settings, 15 si ausente.
    const defaultPrep =
      (order.stores?.store_settings?.settings as any)?.operations
        ?.default_preparation_time_minutes ?? 15;

    // MAX por ítem ACTIVO con la regla exacta guest (variante ?? producto
    // ?? default tienda). Las líneas canceladas se muestran pero no manejan ETA.
    const activeItems = order.order_items.filter(
      (i) => i.cancelled_at == null,
    );
    const prep_minutes_max = activeItems.length
      ? Math.max(
          ...activeItems.map(
            (i) =>
              i.product_variants?.preparation_time_minutes ??
              i.products?.preparation_time_minutes ??
              defaultPrep,
          ),
        )
      : defaultPrep;

    // Logo firmado defensivo: si S3 falla, null y la vista usa el fallback.
    let storeLogoUrl: string | null = null;
    try {
      storeLogoUrl = order.stores?.logo_url
        ? ((await this.s3Service.signUrl(order.stores.logo_url)) ?? null)
        : null;
    } catch {
      storeLogoUrl = null;
    }

    // C.7 (paridad guest) — gate fiscal Subtotal/Impuestos, fail-closed.
    const printsVatBreakdown = resolvePrintsVatBreakdownForPrint(
      order.stores?.organizations,
      order.stores,
    );

    return {
      id: order.id,
      order_number: order.order_number,
      state: order.state,
      subtotal_amount: order.subtotal_amount,
      discount_amount: order.discount_amount,
      tax_amount: order.tax_amount,
      shipping_cost: order.shipping_cost,
      grand_total: order.grand_total,
      currency: order.currency,
      created_at: order.created_at,
      placed_at: order.placed_at,
      completed_at: order.completed_at,
      channel: order.channel,
      // Drives the "home vs shop" reading of a service order on the detail
      // page: `pickup` means the customer goes to the store.
      delivery_type: order.delivery_type,
      // ETA persistido + MAX + gate fiscal + tienda (paridad guest).
      estimated_ready_at: order.estimated_ready_at,
      estimated_delivered_at: order.estimated_delivered_at,
      prep_minutes_max,
      prints_vat_breakdown: printsVatBreakdown,
      store: order.stores
        ? {
            id: order.stores.id,
            name: order.stores.name,
            logo_url: storeLogoUrl,
          }
        : null,
      shipping_address:
        order.shipping_address_snapshot ||
        order.addresses_orders_shipping_address_idToaddresses,
      items: await Promise.all(
        order.order_items.map(async (item) => ({
          id: item.id,
          // The order-detail page needs the product behind the line to send
          // the customer back to it (e.g. re-creating a service reservation
          // that was never persisted as a `bookings` row).
          product_id: item.product_id,
          product_name: item.product_name,
          variant_sku: item.variant_sku,
          variant_attributes: item.variant_attributes,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          // C.8 (R-1, F-008 major): campos ADITIVOS — `unit_price`/
          // `total_price` de arriba NO cambian de magnitud (siguen en
          // BASE). F-008: este endpoint nunca tuvo sombra y nunca escribió
          // `final_unit_price`, así que el fallback derivado de ADR-06 es
          // el camino normal aquí, no una excepción.
          ...this.deriveLineGross(item as any),
          // [resid-fiscal] — Aditivo. La línea cancelada sigue presente
          // en la respuesta (no la quitamos: el cliente la pidió, debe
          // verla tachada con el motivo). El FE la renderiza tachada con
        //   distintivo "Cancelado" cuando `cancelled_at != null`. El total
        //   agregado ya excluye cancelados (`orders.grand_total`).
          cancelled_at: item.cancelled_at ?? null,
          cancellation_reason: item.cancellation_reason ?? null,
          image_url: item.products?.product_images?.[0]?.image_url
            ? await this.s3Service.signUrl(
                item.products.product_images[0].image_url,
              )
            : null,
          variant_image_url: item.variant_image_url
            ? await this.s3Service.signUrl(item.variant_image_url)
            : null,
          // Tells the detail page whether the line is a bookable service.
          // Without it the page treats every order as physical: it renders
          // the shipping stepper for a service-only order and never surfaces
          // the reservation block or the "Reagendar" action.
          product_type: item.products?.product_type ?? null,
          // Cocina/ETA por línea (paridad guest): estado in-flight del
          // ticket + prep variante ?? producto (null si ninguno).
          kitchen_status: this.kitchenStatusFor(item.kitchen_ticket_items),
          preparation_time_minutes:
            item.product_variants?.preparation_time_minutes ??
            item.products?.preparation_time_minutes ??
            null,
        })),
      ),
      // Comprobante por pago (paridad guest): presencia + content-type
      // del HEAD (el visor distingue PDF/imagen con él). Sin key no hay HEAD.
      payments: await Promise.all(
        order.payments.map(async (p) => {
          const hasReceipt = !!p.receipt_s3_key;
          const head = hasReceipt
            ? await this.s3Service.headObject(p.receipt_s3_key)
            : null;
          return {
            id: p.id,
            amount: p.amount,
            state: p.state,
            method: p.store_payment_method?.system_payment_method?.display_name,
            paid_at: p.paid_at,
            has_receipt: hasReceipt,
            receipt_content_type: head?.contentType ?? null,
          };
        }),
      ),
      bookings:
        order.bookings?.map((b: any) => ({
          id: b.id,
          booking_number: b.booking_number,
          date: b.date,
          start_time: b.start_time,
          end_time: b.end_time,
          status: b.status,
          product_id: b.product_id,
          product_name: b.product?.name,
        })) || [],
      // Historical discount snapshots persisted on the order.
      applied_promotions: order.order_promotions.map((op) => ({
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
      applied_coupons: order.coupon_uses.map((cu) => ({
        id: cu.id,
        coupon_id: cu.coupon_id,
        code: cu.coupon?.code ?? null,
        name: cu.coupon?.name ?? null,
        discount_type: cu.coupon?.discount_type ?? null,
        discount_value: cu.coupon?.discount_value ?? null,
        discount_applied: cu.discount_applied,
        used_at: cu.used_at,
      })),
    };
  }

  /**
   * Binding server-side customer→orden→pago para los endpoints de
   * comprobante (espejo de `resolveGuestPayment` con JWT en vez de token).
   * UNA sola lectura relacional; el vínculo pago↔orden lo impone la
   * propia relación, no un parámetro del cliente.
   *
   * 404 ciego: pago ajeno/inexistente y contexto sin usuario/tienda
   * responden el mismo shape de "no existe" sin distinguirlos.
   */
  private async resolveAccountPayment(paymentId: number) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;
    const store_id = context?.store_id;

    const payment = await this.prisma.payments.findFirst({
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
        orders: {
          select: { id: true, state: true, store_id: true, customer_id: true },
        },
      },
    });

    if (!payment || !user_id || !store_id) {
      throw new VendixHttpException(ErrorCodes.PAY_FIND_001);
    }
    const order = payment.orders;
    if (
      !order ||
      order.store_id !== store_id ||
      order.customer_id !== user_id
    ) {
      throw new VendixHttpException(ErrorCodes.PAY_FIND_001);
    }

    return { payment, order };
  }

  /**
   * Espejo de cuenta de `getGuestPaymentReceiptUrl`: URL firmada TTL 5 min
   * + HEAD de content-type. La autorización es el binding de arriba.
   */
  async getPaymentReceiptUrl(
    paymentId: number,
  ): Promise<{ url: string; expires_at: string; content_type: string | null }> {
    const { payment } = await this.resolveAccountPayment(paymentId);

    if (!payment.receipt_s3_key) {
      throw new VendixHttpException(ErrorCodes.PAY_RECEIPT_NOT_FOUND_001);
    }

    const TTL_SECONDS = AccountService.RECEIPT_URL_TTL_SECONDS;
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
   * Subida tardía del comprobante desde el detalle logueado. Mismo
   * contrato que el guest: solo `bank_transfer`/`voucher`, MIME
   * imagen/PDF, 5MB, sin terminales. Re-subir REEMPLAZA la key.
   */
  async uploadPaymentReceipt(
    paymentId: number,
    file: Express.Multer.File | undefined,
  ): Promise<{
    payment_id: number;
    has_receipt: boolean;
    receipt_content_type: string | null;
    receipt_uploaded_at: Date;
  }> {
    const { payment, order } = await this.resolveAccountPayment(paymentId);

    const TERMINAL_ORDER_STATES = ['cancelled', 'refunded', 'finished', 'delivered'];
    const TERMINAL_PAYMENT_STATES = ['succeeded', 'captured', 'refunded', 'cancelled'];
    if (TERMINAL_ORDER_STATES.includes(order.state as string)) {
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
      !AccountService.RECEIPT_ALLOWED_MIME_TYPES.includes(file.mimetype)
    ) {
      throw new VendixHttpException(ErrorCodes.VALIDATION_FILE_TYPE);
    }

    if (file.size > AccountService.RECEIPT_MAX_BYTES) {
      throw new PayloadTooLargeException(
        'El comprobante supera los 5 MB. Comprime la imagen o el PDF e inténtalo de nuevo.',
      );
    }

    const key = await this.uploadAccountReceipt(file, order.store_id);
    const receipt_uploaded_at = new Date();
    const persisted = await this.prisma.payments.updateMany({
      where: { id: payment.id, order_id: order.id },
      data: { receipt_s3_key: key, receipt_uploaded_at },
    });

    // R8-F4 (espejo guest): `count === 0` no es éxito — se purga el
    // objeto recién subido y se responde el 404 ciego del binding.
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
   * Espejo de `uploadGuestReceipt` con la tienda del binding (orden del
   * customer). Misma key `.../receipts/{YYYY}/{MM}/{uuid}-{sanitized}`.
   */
  private async uploadAccountReceipt(
    file: Express.Multer.File,
    storeId: number,
  ): Promise<string> {
    // `organizations` no existe como delegate en el prisma scopeado:
    // se lee por relación desde la tienda (mismo shape que el guest).
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        slug: true,
        organization_id: true,
        organizations: { select: { id: true, slug: true } },
      },
    });
    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    const organization = store.organizations;
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
   * Solo `[a-zA-Z0-9._-]`, resto a `_`; vacío ⇒ `receipt`.
   */
  private sanitizeReceiptFilename(name: string | undefined | null): string {
    const base = (name ?? '').split(/[\\/]/).pop() ?? '';
    const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    return sanitized.length > 0 ? sanitized : 'receipt';
  }

  async getAddresses() {
    // user_id se aplica automáticamente por EcommercePrismaService
    return this.prisma.addresses.findMany({
      where: {}, // user_id se aplica automáticamente
      orderBy: { is_primary: 'desc' },
    });
  }

  async createAddress(dto: CreateAddressDto) {
    // user_id se obtiene del contexto del JWT
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;

    if (!user_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    // If is_primary, unset other primary addresses (user_id se aplica automáticamente)
    if (dto.is_primary) {
      await this.prisma.addresses.updateMany({
        where: { is_primary: true }, // user_id se aplica automáticamente
        data: { is_primary: false },
      });
    }

    // user_id se inyecta automáticamente
    return this.prisma.addresses.create({
      data: {
        address_line1: dto.address_line1,
        address_line2: dto.address_line2,
        city: dto.city,
        state_province: dto.state_province,
        country_code: dto.country_code,
        postal_code: dto.postal_code,
        phone_number: dto.phone_number,
        latitude: dto.latitude,
        longitude: dto.longitude,
        is_primary: dto.is_primary || false,
        type: 'shipping',
      },
    });
  }

  async deleteAddress(address_id: number) {
    // user_id se aplica automáticamente por EcommercePrismaService
    const address = await this.prisma.addresses.findFirst({
      where: {
        id: address_id,
        // user_id se aplica automáticamente
      },
    });

    if (!address) {
      throw new VendixHttpException(ErrorCodes.ECOM_ACCOUNT_001);
    }

    await this.prisma.addresses.delete({
      where: { id: address_id },
    });

    return { message: 'Address deleted' };
  }

  async updateAddress(address_id: number, dto: UpdateAddressDto) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;

    if (!user_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    // Verify address belongs to user
    const address = await this.prisma.addresses.findFirst({
      where: {
        id: address_id,
        user_id,
      },
    });

    if (!address) {
      throw new VendixHttpException(ErrorCodes.ECOM_ACCOUNT_001);
    }

    // If is_primary, unset other primary addresses
    if (dto.is_primary) {
      await this.prisma.addresses.updateMany({
        where: { user_id, is_primary: true },
        data: { is_primary: false },
      });
    }

    return this.prisma.addresses.update({
      where: { id: address_id },
      data: {
        address_line1: dto.address_line1,
        address_line2: dto.address_line2,
        city: dto.city,
        state_province: dto.state_province,
        country_code: dto.country_code,
        postal_code: dto.postal_code,
        phone_number: dto.phone_number,
        latitude: dto.latitude,
        longitude: dto.longitude,
        is_primary: dto.is_primary,
        type: dto.type,
      },
    });
  }

  async setAddressPrimary(address_id: number) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;

    if (!user_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    // Verify address belongs to user
    const address = await this.prisma.addresses.findFirst({
      where: {
        id: address_id,
        user_id,
      },
    });

    if (!address) {
      throw new VendixHttpException(ErrorCodes.ECOM_ACCOUNT_001);
    }

    // Unset all primary addresses for this user
    await this.prisma.addresses.updateMany({
      where: { user_id },
      data: { is_primary: false },
    });

    // Set new primary
    return this.prisma.addresses.update({
      where: { id: address_id },
      data: { is_primary: true },
    });
  }
}
