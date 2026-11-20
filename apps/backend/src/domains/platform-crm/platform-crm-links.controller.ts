import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { PLATFORM_CRM_LINK_PERMISSIONS } from '../../common/constants/platform-permissions.constant';
import { SkipSubscriptionGate } from '../store/subscriptions/decorators/skip-subscription-gate.decorator';
import { PlatformCrmLinksService } from './platform-crm-links.service';
import {
  PlatformCrmContext,
  PlatformCrmCtx,
  PlatformStoreGuard,
} from './platform-store.guard';
import {
  LinkPlatformCustomerDto,
  SearchPlatformAccountsQueryDto,
  UnlinkPlatformCustomerDto,
} from './dto/platform-crm-links.dto';

/**
 * Vendix Platform · enlace prospecto CRM ↔ organización cliente.
 *
 * Bajo `store/*` a propósito: el `DomainScopeGuard` global ya exige un token
 * de STORE_ADMIN. `PlatformStoreGuard` corre ANTES que `PermissionsGuard`: una
 * tienda ajena recibe 404 sin llegar a la verificación de permisos (que sí
 * revelaría la función con un 403).
 *
 * `@SkipSubscriptionGate()`: sin él, una tienda ajena con la suscripción
 * bloqueada recibiría el error del gate (en POST/DELETE) en vez del 404.
 */
@Controller('store/platform-crm')
@UseGuards(PlatformStoreGuard, PermissionsGuard)
@SkipSubscriptionGate()
export class PlatformCrmLinksController {
  constructor(
    private readonly service: PlatformCrmLinksService,
    private readonly response: ResponseService,
  ) {}

  /** Organizaciones cliente y sus tiendas, para enlazar la org entera o una tienda. */
  @Get('accounts/search')
  @Permissions(PLATFORM_CRM_LINK_PERMISSIONS.MANAGE)
  async searchAccounts(@Query() query: SearchPlatformAccountsQueryDto) {
    return this.response.success(await this.service.searchAccounts(query.q));
  }

  /** Todas las cuentas Vendix enlazadas del cliente (D2: puede tener varias). */
  @Get('customers/:customerId/links')
  @Permissions(PLATFORM_CRM_LINK_PERMISSIONS.READ)
  async listLinks(
    @PlatformCrmCtx() ctx: PlatformCrmContext,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.response.success(await this.service.listLinks(ctx, customerId));
  }

  /** Desenlaza UNA cuenta; el enlace debe ser de este cliente (si no, 404). */
  @Delete('customers/:customerId/links/:linkId')
  @Permissions(PLATFORM_CRM_LINK_PERMISSIONS.MANAGE)
  async unlinkById(
    @PlatformCrmCtx() ctx: PlatformCrmContext,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Param('linkId', ParseIntPipe) linkId: number,
    @Body() dto: UnlinkPlatformCustomerDto,
  ) {
    return this.response.success(
      await this.service.unlinkById(ctx, customerId, linkId, dto),
      'Enlace deshecho',
    );
  }

  /** @deprecated Usar `GET customers/:customerId/links`. Devuelve el enlace más antiguo. */
  @Get('customers/:customerId/link')
  @Permissions(PLATFORM_CRM_LINK_PERMISSIONS.READ)
  async getLink(
    @PlatformCrmCtx() ctx: PlatformCrmContext,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.response.success(await this.service.getLink(ctx, customerId));
  }

  @Post('customers/:customerId/link')
  @Permissions(PLATFORM_CRM_LINK_PERMISSIONS.MANAGE)
  async link(
    @PlatformCrmCtx() ctx: PlatformCrmContext,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: LinkPlatformCustomerDto,
  ) {
    return this.response.success(
      await this.service.link(ctx, customerId, dto),
      'Cliente enlazado con su cuenta Vendix',
    );
  }

  /**
   * @deprecated Usar `DELETE customers/:customerId/links/:linkId`. Con más de
   * un enlace activo responde 409 (`PLATFORM_CRM_011`).
   */
  @Delete('customers/:customerId/link')
  @Permissions(PLATFORM_CRM_LINK_PERMISSIONS.MANAGE)
  async unlink(
    @PlatformCrmCtx() ctx: PlatformCrmContext,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: UnlinkPlatformCustomerDto,
  ) {
    return this.response.success(
      await this.service.unlink(ctx, customerId, dto),
      'Enlace deshecho',
    );
  }
}
