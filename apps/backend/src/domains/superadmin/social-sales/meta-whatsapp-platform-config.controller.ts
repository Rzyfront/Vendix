import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { UpdateMetaWhatsappPlatformConfigDto } from './dto/update-meta-whatsapp-platform-config.dto';
import { MetaWhatsappPlatformConfigService } from './meta-whatsapp-platform-config.service';

@Controller('superadmin/social-sales/meta')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class MetaWhatsappPlatformConfigController {
  constructor(
    private readonly configService: MetaWhatsappPlatformConfigService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('config')
  @Permissions('superadmin:social_sales:config:read')
  async getConfig() {
    const result = await this.configService.getMaskedConfig();
    return this.responseService.success(result, 'Configuración Meta obtenida');
  }

  @Patch('config')
  @Permissions('superadmin:social_sales:config:write')
  async updateConfig(@Body() dto: UpdateMetaWhatsappPlatformConfigDto) {
    const userId = RequestContextService.getContext()?.user_id ?? null;
    const result = await this.configService.updateConfig(dto, userId);
    return this.responseService.updated(result, 'Configuración Meta guardada');
  }
}
