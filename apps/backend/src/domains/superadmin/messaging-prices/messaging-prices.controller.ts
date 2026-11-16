import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { UpdateMessagingPricesDto } from './dto/update-messaging-prices.dto';
import { SuperadminMessagingPricesService } from './messaging-prices.service';

@Controller('superadmin/messaging/prices')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperadminMessagingPricesController {
  constructor(
    private readonly pricesService: SuperadminMessagingPricesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('superadmin:messaging:prices:read')
  async getPrices() {
    const result = await this.pricesService.getPrices();
    return this.responseService.success(
      result,
      'Precios de mensajería obtenidos',
    );
  }

  @Patch()
  @Permissions('superadmin:messaging:prices:write')
  async updatePrices(@Body() dto: UpdateMessagingPricesDto) {
    const userId = RequestContextService.getContext()?.user_id ?? null;
    const result = await this.pricesService.updatePrices(dto, userId);
    return this.responseService.updated(
      result,
      'Precios de mensajería guardados',
    );
  }
}
