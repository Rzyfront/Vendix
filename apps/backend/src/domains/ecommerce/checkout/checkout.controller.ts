import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validateOrReject, ValidationError } from 'class-validator';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto/checkout.dto';
import { WhatsappCheckoutDto } from './dto/whatsapp-checkout.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StoreAvailabilityGuard } from './guards/store-availability.guard';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';
import { RequestContextService } from '@common/context/request-context.service';

@Controller('ecommerce/checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(private readonly checkout_service: CheckoutService) {}

  /**
   * Returns whether the current ecommerce store has invoicing enabled
   * (fiscal_status.invoicing.state === 'ACTIVE'). Used by guest checkout to
   * decide if the optional invoice data section should be shown.
   *
   * Public-friendly: works with @OptionalAuth() so guests can call it. Store
   * context is resolved from the ecommerce domain by DomainResolverMiddleware.
   */
  @Get('eligibility')
  @OptionalAuth()
  async getEligibility() {
    const data = await this.checkout_service.getInvoicingEligibility();
    return { success: true, data };
  }

  /**
   * CP-tienda-checkout-whatsapp (C.2): tipos de entrega que la tienda expone
   * para el paso 0 del checkout ("¿Cómo quieres recibirlo?"). Solo ids y
   * nombres de métodos ACTIVOS — la misma información que el comprador ya ve
   * al cotizar el envío. Público (`@OptionalAuth()`) como el resto del
   * escaparate; el tenant lo resuelve `DomainResolverMiddleware`.
   */
  @Get('delivery-options')
  @OptionalAuth()
  async getDeliveryOptions() {
    const data = await this.checkout_service.getDeliveryOptions();
    return { success: true, data };
  }

  @Get('payment-methods')
  @OptionalAuth()
  async getPaymentMethods(@Query('shipping_type') shippingType?: string) {
    // store_id se resuelve automáticamente desde el dominio
    // shipping_type filters payment methods by processing_mode:
    // - pickup: DIRECT + ONLINE
    // - delivery/carrier/etc: ONLINE + ON_DELIVERY
    const data = await this.checkout_service.getPaymentMethods(shippingType);
    return { success: true, data };
  }

  /**
   * QUI-728 — devuelve las cuentas bancarias activas que la tienda del
   * contexto puede mostrar al comprador para el método `methodId`. Endpoint
   * público-friendly (`@OptionalAuth()`) para que el checkout guest pueda
   * pedirlo sin sesión; el contexto de tienda lo resuelve
   * `DomainResolverMiddleware`.
   *
   * NO envuelve el handler en try/catch: el patrón del módulo
   * (`BankAccountsController` ya migrado por QUI-728) confirma que
   * `responseService.error` retorna 201+success:false y rompe el `catchError`
   * del frontend. Las excepciones suben al `AllExceptionsFilter` global.
   */
  @Get('payment-methods/:methodId/bank-accounts')
  @OptionalAuth()
  async getBankAccountsForPaymentMethod(
    @Param('methodId', ParseIntPipe) methodId: number,
  ) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      // Sin contexto de tienda el `DomainResolverMiddleware` ya habría
      // rechazado la petición aguas arriba; este 400 es por defensa en
      // profundidad si alguien llama al endpoint directamente.
      throw new BadRequestException(
        'Se requiere contexto de tienda para listar cuentas bancarias',
      );
    }
    const data = await this.checkout_service.getBankAccountsForMethod(
      methodId,
      storeId,
    );
    return { success: true, data };
  }

  /**
   * Checkout endpoint. Accepts `multipart/form-data` so the customer can
   * optionally attach a payment receipt (`file`) when paying with
   * bank_transfer / voucher. The actual CheckoutDto travels as a JSON string
   * under the `data` field — global ValidationPipe cannot validate it
   * automatically because multipart fields arrive as strings, so we
   * parse + transform + validate manually here before delegating to the
   * service.
   *
   * Backwards-compatibility: JSON-body clients still work because Nest's
   * FileInterceptor falls through gracefully when `Content-Type` is
   * `application/json` — in that case `file` is undefined and the parsed
   * body is `dto` directly under @Body().
   */
  @Post()
  @OptionalAuth()
  @UseGuards(StoreAvailabilityGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async checkout(
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const dto = await this.parseCheckoutBody(body);
    // store_id y user_id se resuelven automáticamente
    const data = await this.checkout_service.checkout(dto, file);
    return { success: true, data };
  }

  /**
   * QUI-728 — devuelve una URL prefirmada (TTL 5 min) al comprobante de
   * transferencia/voucher del comprador autenticado. El control de acceso
   * está delegado al scope de `EcommercePrismaService.payments`: la query
   * aplica `customer_id = req.user.id` automáticamente, y si el `id` no
   * pertenece al comprador el `findFirst` devuelve null → 404 indistinguible
   * de «no existe» (mismo shape que la versión admin en
   * `OrdersController.getPaymentReceiptUrl`).
   *
   * Distinto del endpoint admin en dos puntos:
   *  - Auth: `JwtAuthGuard` sin `@OptionalAuth()` — el comprobante requiere
   *    comprador identificado. Un guest no subió comprobante (no llega a
   *    este pago porque la subida exige user_id en el flujo de upload).
   *  - Path: `/ecommerce/payments/:paymentId/receipt-url` (no
   *    `/ecommerce/orders/:id/payments/:paymentId/...`) — el comprador no
   *    conoce su `order_id` y no debería tener que navegarlo.
   */
  @Get('payments/:paymentId/receipt-url')
  @UseGuards(JwtAuthGuard)
  async getPaymentReceiptUrl(
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ) {
    const data = await this.checkout_service.getPaymentReceiptUrl(paymentId);
    return { success: true, data };
  }

  /**
   * Resolve and validate the CheckoutDto from a hybrid body shape:
   *  - multipart: a `data` field carrying the DTO as a JSON string.
   *  - JSON: the body itself is already the DTO.
   */
  private async parseCheckoutBody(body: any): Promise<CheckoutDto> {
    let raw: any = body;
    if (body && typeof body === 'object' && typeof body.data === 'string') {
      try {
        raw = JSON.parse(body.data);
      } catch {
        throw new BadRequestException(
          'El campo "data" del formulario debe ser JSON válido',
        );
      }
    }

    const instance = plainToInstance(CheckoutDto, raw ?? {});
    try {
      await validateOrReject(instance, {
        whitelist: true,
        forbidNonWhitelisted: false,
      });
    } catch (errors) {
      const messages = this.collectValidationMessages(
        errors as ValidationError[],
      );
      throw new BadRequestException(messages);
    }
    return instance;
  }

  private collectValidationMessages(errors: ValidationError[]): string[] {
    const out: string[] = [];
    const walk = (err: ValidationError) => {
      if (err.constraints) {
        for (const msg of Object.values(err.constraints)) out.push(msg);
      }
      if (err.children?.length) err.children.forEach(walk);
    };
    errors.forEach(walk);
    return out.length ? out : ['Checkout payload validation failed'];
  }

  @Post('prepare-wompi')
  @OptionalAuth()
  async prepareWompiPayment(
    @Body()
    dto: {
      order_id: number;
      amount: number;
      currency?: string;
      customer_email?: string;
      redirect_url?: string;
      public_order_token?: string;
    },
  ) {
    const data = await this.checkout_service.prepareWompiPayment(dto);
    return { success: true, data };
  }

  /**
   * Force-confirm a Wompi payment for an order by polling the Wompi API
   * directly. Called by the frontend widget callback so the user sees the
   * correct order/payment state immediately on return — does not replace
   * the canonical webhook flow, only complements it.
   *
   * Auth: customer JWT (same JwtAuthGuard as the rest of /ecommerce/checkout).
   * Tenant: store context resolved from x-store-id header (CheckoutService
   * uses StorePrismaService which scopes by store).
   */
  @Post('confirm-wompi-payment/:orderId')
  @OptionalAuth()
  async confirmWompiPayment(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: { public_order_token?: string },
  ) {
    const data = await this.checkout_service.confirmWompiPayment(
      orderId,
      dto.public_order_token,
    );
    return { success: true, data };
  }

  /**
   * LEGACY — se conserva por compatibilidad con clientes que crean la orden
   * directa por WhatsApp sin pasar por el checkout. El storefront ya NO lo
   * usa: "Finalizar por WhatsApp" recorre `POST /ecommerce/checkout` con
   * `channel='whatsapp'` (mismo núcleo, mismo cálculo; ver
   * CP-tienda-checkout-whatsapp ADR-1). No añadirle nuevas capacidades.
   */
  @OptionalAuth()
  @Post('whatsapp')
  @UseGuards(StoreAvailabilityGuard)
  async whatsappCheckout(@Body() dto: WhatsappCheckoutDto) {
    const data = await this.checkout_service.whatsappCheckout(dto);
    return { success: true, data };
  }
}
