import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { API_KEYS_MANAGE_PERMISSION } from '../../integrations/api-keys/api-key.constants';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookDeliveriesQueryDto,
} from './workflow-webhook.dto';
import { WorkflowWebhooksService } from './workflow-webhooks.service';

/** Outgoing webhooks of the store. JWT only (an API key cannot manage them). */
@Controller('store/integrations/webhooks')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowWebhooksController {
  constructor(
    private readonly webhooks: WorkflowWebhooksService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async list() {
    return this.responseService.success(await this.webhooks.list());
  }

  /** The `secret` in the response is shown once and cannot be recovered. */
  @Post()
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async create(@Body() dto: CreateWebhookDto) {
    return this.responseService.created(
      await this.webhooks.create(dto),
      'Webhook creado. Copia el secreto de firma ahora: no se volverá a mostrar.',
    );
  }

  @Post('deliveries/:deliveryId/retry')
  @HttpCode(200)
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async retry(@Param('deliveryId', ParseIntPipe) deliveryId: number) {
    return this.responseService.updated(
      await this.webhooks.retryDelivery(deliveryId),
      'Entrega reencolada',
    );
  }

  @Patch(':id')
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.responseService.updated(
      await this.webhooks.update(id, dto),
      'Webhook actualizado',
    );
  }

  /** Returns the new signing secret once; the previous one stops working. */
  @Post(':id/rotate-secret')
  @HttpCode(200)
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async rotate(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.updated(
      await this.webhooks.rotateSecret(id),
      'Secreto rotado. Copia el nuevo secreto ahora: no se volverá a mostrar.',
    );
  }

  @Post(':id/test')
  @HttpCode(200)
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async test(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(
      await this.webhooks.test(id),
      'Evento de prueba encolado',
    );
  }

  @Get(':id/deliveries')
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async deliveries(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: WebhookDeliveriesQueryDto,
  ) {
    const r = await this.webhooks.deliveries(id, query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Delete(':id')
  @HttpCode(200)
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.updated(
      await this.webhooks.remove(id),
      'Webhook desactivado',
    );
  }
}
