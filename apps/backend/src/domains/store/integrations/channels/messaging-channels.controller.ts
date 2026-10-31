import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { MessagingChannelsService } from './messaging-channels.service';
import { UpdateSmsChannelDto } from './dto/update-sms-channel.dto';
import { UpdateEmailChannelDto } from './dto/update-email-channel.dto';

/**
 * SMS and email settings under Integraciones → Canales (PLAN-CRM §4.2).
 * Same prefix as the WhatsApp channel endpoints; only the routes it declares.
 */
@Controller('store/integrations/channels')
@UseGuards(PermissionsGuard)
export class MessagingChannelsController {
  constructor(
    private readonly channels: MessagingChannelsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:social_sales:read')
  async list() {
    const result = await this.channels.list();
    return this.responseService.success(result, 'Canales obtenidos');
  }

  @Put('sms')
  @Permissions('store:social_sales:manage')
  async updateSms(@Body() dto: UpdateSmsChannelDto) {
    const result = await this.channels.updateSms(dto);
    return this.responseService.success(result, 'Canal SMS actualizado');
  }

  @Put('email')
  @Permissions('store:social_sales:manage')
  async updateEmail(@Body() dto: UpdateEmailChannelDto) {
    const result = await this.channels.updateEmail(dto);
    return this.responseService.success(result, 'Canal de correo actualizado');
  }
}
