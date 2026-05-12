import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  ParseIntPipe,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { CustomerQueueService } from './customer-queue.service';
import { QrService } from '../../../common/services/qr.service';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

@Controller('store/customer-queue')
@UseGuards(RolesGuard, PermissionsGuard)
export class CustomerQueueController {
  constructor(
    private readonly queueService: CustomerQueueService,
    private readonly qrService: QrService,
    private readonly responseService: ResponseService,
    private readonly prisma: StorePrismaService,
  ) {}

  @Get()
  @Permissions('store:customers:read')
  async getQueue(@Req() req: AuthenticatedRequest) {
    if (!req.user.store_id)
      throw new BadRequestException('Store context required');
    const entries = await this.queueService.getWaitingEntries(
      req.user.store_id,
    );
    return this.responseService.success(entries);
  }

  @Get('qr')
  @Permissions('store:customers:read')
  async getQrCode(@Req() req: AuthenticatedRequest) {
    if (!req.user.store_id)
      throw new BadRequestException('Store context required');
    const domainHostname = await this.getEcommerceDomainForStore(
      req.user.store_id,
    );
    const protocol = req.protocol || 'https';
    const baseUrl = domainHostname
      ? `${protocol}://${domainHostname}`
      : `${protocol}://vendix.com`;
    const qrUrl = `${baseUrl}/fila`;
    const dataUrl = await this.qrService.generateDataUrl(qrUrl, 300);
    return this.responseService.success({ qr_data_url: dataUrl, url: qrUrl });
  }

  @Post(':id/select')
  @Permissions('store:customers:read')
  async selectEntry(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const entry = await this.queueService.selectEntry(id, req.user.id);
    return this.responseService.success(entry);
  }

  @Post(':id/release')
  @Permissions('store:customers:read')
  async releaseEntry(@Param('id', ParseIntPipe) id: number) {
    const entry = await this.queueService.releaseEntry(id);
    return this.responseService.success(entry);
  }

  @Post(':id/consume')
  @Permissions('store:customers:read')
  async consumeEntry(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body('order_id', ParseIntPipe) orderId: number,
  ) {
    if (!req.user.store_id)
      throw new BadRequestException('Store context required');
    const result = await this.queueService.consumeEntry(
      id,
      orderId,
      req.user.store_id,
    );
    return this.responseService.success(result);
  }

  @Delete(':id')
  @Permissions('store:customers:read')
  async cancelEntry(@Param('id', ParseIntPipe) id: number) {
    const entry = await this.queueService.cancelEntry(id);
    return this.responseService.success(entry);
  }

  private async getEcommerceDomainForStore(
    storeId: number,
  ): Promise<string | null> {
    try {
      // Prefer STORE_ECOMMERCE domain, fallback to primary
      const ecommerceDomain = await this.prisma.domain_settings.findFirst({
        where: { store_id: storeId, app_type: 'STORE_ECOMMERCE' },
        select: { hostname: true },
      });
      if (ecommerceDomain?.hostname) return ecommerceDomain.hostname;

      const primaryDomain = await this.prisma.domain_settings.findFirst({
        where: { store_id: storeId, is_primary: true },
        select: { hostname: true },
      });
      return primaryDomain?.hostname || null;
    } catch {
      return null;
    }
  }
}
