import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { ListServiceRemindersDto } from './dto';
import { ServiceRemindersService } from './service-reminders.service';

@ApiTags('Store Service Reminders')
@Controller('store/service-reminders')
@UseGuards(PermissionsGuard)
export class ServiceRemindersController {
  constructor(
    private readonly serviceReminders: ServiceRemindersService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('store:reservations:read')
  @ApiOperation({ summary: 'Listar recordatorios de servicios recurrentes' })
  @ApiResponse({ status: 200, description: 'Lista de recordatorios obtenida exitosamente' })
  async list(@Query() query: ListServiceRemindersDto) {
    const result = await this.serviceReminders.list(query);
    return this.response.success(result, 'Recordatorios obtenidos exitosamente');
  }

  @Post(':id/email')
  @Permissions('store:reservations:update')
  @ApiOperation({ summary: 'Enviar recordatorio por correo electrónico' })
  @ApiResponse({ status: 200, description: 'Correo enviado' })
  async sendEmail(@Param('id', ParseIntPipe) id: number) {
    const result = await this.serviceReminders.sendEmail(id);
    return this.response.success(result, 'Correo enviado exitosamente');
  }

  @Post(':id/whatsapp')
  @Permissions('store:reservations:update')
  @ApiOperation({ summary: 'Generar enlace y mensaje para WhatsApp' })
  @ApiResponse({ status: 200, description: 'Enlace generado' })
  async whatsappLink(@Param('id', ParseIntPipe) id: number) {
    const result = await this.serviceReminders.whatsappLink(id);
    return this.response.success(result, 'Enlace de WhatsApp generado exitosamente');
  }

  @Patch(':id/dismiss')
  @Permissions('store:reservations:update')
  @ApiOperation({ summary: 'Descartar recordatorio' })
  @ApiResponse({ status: 200, description: 'Recordatorio descartado' })
  async dismiss(@Param('id', ParseIntPipe) id: number) {
    const result = await this.serviceReminders.dismiss(id);
    return this.response.updated(result, 'Recordatorio descartado exitosamente');
  }
}
