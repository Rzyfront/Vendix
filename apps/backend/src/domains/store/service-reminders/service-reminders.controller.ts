import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { ListServiceRegistryDto, ListServiceRemindersDto, ServiceRegistryActionDto, ServiceRegistryAssignCustomerDto, ServiceRegistryWhatsappDto } from './dto';
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

  // --- Registro de servicios y estaciones -----------------------------------
  // Declarado ANTES de las rutas `:id/...` para que `registry/email` no caiga
  // en `:id/email` (ParseIntPipe rechazaría "registry").

  @Get('registry')
  @Permissions('store:reservations:read')
  @ApiOperation({ summary: 'Registro de servicios realizados (estaciones + órdenes recurrentes) con próxima fecha' })
  @ApiResponse({ status: 200, description: 'Registro paginado; meta.stats = { total, recurring, due_soon, overdue }' })
  async registry(@Query() query: ListServiceRegistryDto) {
    const result = await this.serviceReminders.registry(query);
    return this.response.paginated(
      result.items,
      result.total,
      result.page,
      result.limit,
      'Registro de servicios obtenido exitosamente',
      undefined,
      { stats: result.stats },
    );
  }

  @Post('registry/email')
  @HttpCode(200)
  @Permissions('store:reservations:update')
  @ApiOperation({ summary: 'Enviar por correo el mensaje de una fila del registro (crea el recordatorio si no existe)' })
  async registryEmail(@Body() dto: ServiceRegistryActionDto) {
    const result = await this.serviceReminders.registryEmail(dto);
    return this.response.success(result, 'Correo enviado exitosamente');
  }

  @Post('registry/whatsapp')
  @HttpCode(200)
  @Permissions('store:reservations:update')
  @ApiOperation({ summary: 'Generar enlace de WhatsApp para una fila del registro (crea el recordatorio si no existe)' })
  async registryWhatsapp(@Body() dto: ServiceRegistryWhatsappDto) {
    const result = await this.serviceReminders.registryWhatsapp(dto);
    return this.response.success(result, 'Enlace de WhatsApp generado exitosamente');
  }

  @Post('registry/assign-customer')
  @HttpCode(200)
  @Permissions('store:reservations:update')
  @ApiOperation({ summary: 'Asignar un cliente registrado a una atención hecha sin cliente' })
  async registryAssignCustomer(@Body() dto: ServiceRegistryAssignCustomerDto) {
    const result = await this.serviceReminders.registryAssignCustomer(dto);
    return this.response.updated(result, 'Cliente asignado');
  }

  @Post('registry/dismiss')
  @HttpCode(200)
  @Permissions('store:reservations:update')
  @ApiOperation({ summary: 'Descartar el recordatorio de una fila del registro (crea el recordatorio si no existe)' })
  async registryDismiss(@Body() dto: ServiceRegistryActionDto) {
    const result = await this.serviceReminders.registryDismiss(dto);
    return this.response.updated(result, 'Recordatorio descartado exitosamente');
  }

  // --- Recordatorios por id de log (compatibilidad) --------------------------

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
