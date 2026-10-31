import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { CRM_TASKS_PERMISSION, CrmTasksService } from './crm-tasks.service';
import {
  CreateCrmTaskDto,
  CrmTasksQueryDto,
  UpdateCrmTaskDto,
} from './dto/crm-tasks.dto';

/**
 * CRM tasks (PLAN-CRM §4.6).
 *
 *   GET   /store/customers/crm/tasks             ?assigned&status&due&customer_id
 *   GET   /store/customers/crm/tasks/today       my overdue + due today
 *   GET   /store/customers/crm/tasks/stats
 *   GET   /store/customers/crm/tasks/:id
 *   POST  /store/customers/crm/tasks
 *   PATCH /store/customers/crm/tasks/:id
 *   POST  /store/customers/crm/tasks/:id/complete
 *   POST  /store/customers/crm/tasks/:id/reopen
 */
@Controller('store/customers/crm/tasks')
@UseGuards(PermissionsGuard)
export class CrmTasksController {
  constructor(
    private readonly service: CrmTasksService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions(CRM_TASKS_PERMISSION)
  async list(@Query() query: CrmTasksQueryDto) {
    const { data, total, page, limit } = await this.service.list(query);
    return this.response.paginated(data, total, page, limit);
  }

  @Get('today')
  @Permissions(CRM_TASKS_PERMISSION)
  async today() {
    return this.response.success(await this.service.today());
  }

  @Get('stats')
  @Permissions(CRM_TASKS_PERMISSION)
  async stats() {
    return this.response.success(await this.service.stats());
  }

  @Get(':id')
  @Permissions(CRM_TASKS_PERMISSION)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.findOne(id));
  }

  @Post()
  @Permissions(CRM_TASKS_PERMISSION)
  async create(@Body() dto: CreateCrmTaskDto) {
    return this.response.success(await this.service.create(dto), 'Tarea creada');
  }

  @Patch(':id')
  @Permissions(CRM_TASKS_PERMISSION)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCrmTaskDto,
  ) {
    return this.response.success(
      await this.service.update(id, dto),
      'Tarea actualizada',
    );
  }

  @Post(':id/complete')
  @Permissions(CRM_TASKS_PERMISSION)
  async complete(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.service.complete(id),
      'Tarea completada',
    );
  }

  @Post(':id/reopen')
  @Permissions(CRM_TASKS_PERMISSION)
  async reopen(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.service.reopen(id),
      'Tarea reabierta',
    );
  }
}
