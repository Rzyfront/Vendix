import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ResponseService } from '@common/responses/response.service';
import { WompiClientFactory } from '../payments/processors/wompi/wompi.factory';
import { WompiEnvironment } from '../payments/processors/wompi/wompi.types';
import { PaymentEncryptionService } from '../payments/services/payment-encryption.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { PaymentLinkQueryDto } from './dto/payment-link-query.dto';

@Injectable()
export class PaymentLinksService {
  private readonly logger = new Logger(PaymentLinksService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly response: ResponseService,
    private readonly wompiClientFactory: WompiClientFactory,
    private readonly paymentEncryption: PaymentEncryptionService,
  ) {}

  private async getWompiConfig(): Promise<Record<string, any>> {
    const methods = await this.prisma.store_payment_methods.findMany({
      where: { state: 'enabled', system_payment_method: { type: 'wompi' } },
      include: { system_payment_method: true },
    });

    const wompiMethod = methods[0];
    if (!wompiMethod?.custom_config) {
      throw new BadRequestException(
        'Wompi no está configurado para esta tienda. Configúralo en Ajustes > Pagos.',
      );
    }

    const config = wompiMethod.custom_config as Record<string, any>;
    return this.paymentEncryption.decryptConfig(config, 'wompi');
  }

  private resolveClient(config: Record<string, any>) {
    const wompiConfig = {
      public_key: config.public_key,
      private_key: config.private_key,
      events_secret: config.events_secret || '',
      integrity_secret: config.integrity_secret || '',
      environment:
        (config.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
    };
    return this.wompiClientFactory.getClient('payment-links', wompiConfig);
  }

  async create(dto: CreatePaymentLinkDto) {
    const config = await this.getWompiConfig();
    const client = this.resolveClient(config);

    const wompiData: any = {
      name: dto.name,
      description: dto.description,
      single_use: dto.single_use,
      collect_shipping: dto.collect_shipping,
    };

    if (dto.amount_in_cents != null)
      wompiData.amount_in_cents = dto.amount_in_cents;
    if (dto.currency) wompiData.currency = dto.currency;
    if (dto.expires_at) wompiData.expires_at = dto.expires_at;
    if (dto.redirect_url) wompiData.redirect_url = dto.redirect_url;
    if (dto.image_url) wompiData.image_url = dto.image_url;
    if (dto.sku) wompiData.sku = dto.sku;
    if (dto.customer_references?.length) {
      wompiData.customer_data = {
        customer_references: dto.customer_references,
      };
    }

    const response = await client.createPaymentLink(wompiData);
    const linkData = response.data;

    const paymentLink = await this.prisma.payment_links.create({
      data: {
        wompi_link_id: linkData.id,
        name: linkData.name,
        description: linkData.description,
        amount_in_cents: linkData.amount_in_cents,
        currency: linkData.currency || 'COP',
        single_use: linkData.single_use,
        collect_shipping: linkData.collect_shipping,
        checkout_url: `https://checkout.wompi.co/l/${linkData.id}`,
        status: 'active',
        expires_at: linkData.expires_at ? new Date(linkData.expires_at) : null,
        redirect_url: linkData.redirect_url,
        image_url: linkData.image_url,
        sku: linkData.sku,
        order_id: dto.order_id || null,
        wompi_response: response as any,
      },
    });

    return this.response.success(
      paymentLink,
      'Link de pago creado exitosamente',
    );
  }

  async findAll(query: PaymentLinkQueryDto) {
    // Update expired links first
    await this.checkExpiredLinks();

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.payment_links.findMany({
        where,
        orderBy: {
          [query.sort_by || 'created_at']: query.sort_order || 'desc',
        },
        skip,
        take: limit,
        include: { orders: { select: { id: true, order_number: true } } },
      }),
      this.prisma.payment_links.count({ where }),
    ]);

    return this.response.success({
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  }

  async findOne(id: number) {
    const link = await this.prisma.payment_links.findUnique({
      where: { id },
      include: {
        orders: { select: { id: true, order_number: true, grand_total: true } },
      },
    });

    if (!link) throw new BadRequestException('Link de pago no encontrado');
    return this.response.success(link);
  }

  async getStats() {
    const [total, active, paid, expired] = await Promise.all([
      this.prisma.payment_links.count(),
      this.prisma.payment_links.count({ where: { status: 'active' } }),
      this.prisma.payment_links.count({ where: { status: 'paid' } }),
      this.prisma.payment_links.count({ where: { status: 'expired' } }),
    ]);

    return this.response.success({ total, active, paid, expired });
  }

  async deactivate(id: number) {
    const link = await this.prisma.payment_links.findUnique({ where: { id } });
    if (!link) throw new BadRequestException('Link de pago no encontrado');
    if (link.status !== 'active')
      throw new BadRequestException('Solo se pueden desactivar links activos');

    const updated = await this.prisma.payment_links.update({
      where: { id },
      data: { status: 'cancelled', updated_at: new Date() },
    });

    return this.response.success(updated, 'Link de pago desactivado');
  }

  async handlePaymentCompleted(
    wompiLinkId: string,
    transactionData: any,
  ): Promise<void> {
    const link = await (
      this.prisma.withoutScope() as any
    ).payment_links.findFirst({
      where: { wompi_link_id: wompiLinkId },
    });

    if (!link) {
      this.logger.warn(
        `Payment link not found for Wompi link ID: ${wompiLinkId}`,
      );
      return;
    }

    await (this.prisma.withoutScope() as any).payment_links.update({
      where: { id: link.id },
      data: {
        status: 'paid',
        transaction_id: transactionData?.id,
        paid_at: new Date(),
        updated_at: new Date(),
      },
    });

    this.logger.log(`Payment link ${wompiLinkId} marked as paid`);
  }

  private async checkExpiredLinks(): Promise<void> {
    try {
      await this.prisma.payment_links.updateMany({
        where: {
          status: 'active',
          expires_at: { lt: new Date() },
        },
        data: { status: 'expired', updated_at: new Date() },
      });
    } catch (error) {
      this.logger.warn(`Failed to check expired links: ${error.message}`);
    }
  }
}
