import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { RemindersService } from './reminders.service';
import {
  CreateReminderDto,
  RemindersQueryDto,
  UpdateReminderDto,
} from './dto/reminders.dto';

/**
 * QUI-580 — personal reminders log (bitácora). No RBAC permission: like the
 * notifications bell, it is personal and every operation is bound to the
 * session's store AND user (see `RemindersService`).
 *
 *   GET    /store/reminders        ?status=pending|done|all&due=overdue|today|upcoming|no_date&limit
 *   GET    /store/reminders/:id
 *   POST   /store/reminders
 *   PATCH  /store/reminders/:id    (title, note, remind_at, status, link)
 *   DELETE /store/reminders/:id
 */
@Controller('store/reminders')
export class RemindersController {
  constructor(
    private readonly service: RemindersService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  async list(@Query() query: RemindersQueryDto) {
    const actor = this.service.actorFromRequest();
    return this.response.success(await this.service.list(actor, query));
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const actor = this.service.actorFromRequest();
    return this.response.success(await this.service.findOne(actor, id));
  }

  @Post()
  async create(@Body() dto: CreateReminderDto) {
    const actor = this.service.actorFromRequest();
    return this.response.success(
      await this.service.create(actor, dto, 'manual'),
      'Recordatorio creado',
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReminderDto,
  ) {
    const actor = this.service.actorFromRequest();
    return this.response.success(
      await this.service.update(actor, id, dto),
      'Recordatorio actualizado',
    );
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const actor = this.service.actorFromRequest();
    return this.response.success(
      await this.service.remove(actor, id),
      'Recordatorio eliminado',
    );
  }
}
