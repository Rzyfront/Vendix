import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { HousekeepingService } from './housekeeping.service';
import { ChangeHousekeepingStatusDto } from './change-housekeeping-status.dto';
import { HousekeepingTasksService } from './housekeeping-tasks.service';
import { AssignHousekeepingTaskDto } from './assign-housekeeping-task.dto';

/** Hospitality Suite — room status board (H5.1) and tasks per housekeeper (H5.2). */
@Controller('store/hospitality/housekeeping')
@UseGuards(PermissionsGuard)
export class HousekeepingController {
  constructor(
    private readonly housekeepingService: HousekeepingService,
    private readonly tasksService: HousekeepingTasksService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Tablero de estado de las habitaciones' })
  @Get()
  @Permissions('store:lodging:housekeeping:read')
  async board() {
    const result = await this.housekeepingService.board();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Cambiar el estado de limpieza de una habitación' })
  @Patch('units/:id/status')
  @Permissions('store:lodging:housekeeping:operate')
  async changeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeHousekeepingStatusDto,
  ) {
    const result = await this.housekeepingService.changeStatus(id, dto.from, dto.status);
    return this.responseService.updated(result, 'Estado de la habitación actualizado');
  }

  @ApiOperation({ summary: 'Tareas de limpieza del día y camareras para asignarlas' })
  @Get('tasks')
  @Permissions('store:lodging:housekeeping:assign')
  async tasks() {
    const result = await this.tasksService.today();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Mis tareas de limpieza del día' })
  @Get('my-tasks')
  @Permissions('store:lodging:housekeeping:operate')
  async myTasks() {
    const result = await this.tasksService.mine();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Asignar una tarea de limpieza a una camarera' })
  @Patch('tasks/:id/assign')
  @Permissions('store:lodging:housekeeping:assign')
  async assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignHousekeepingTaskDto,
  ) {
    const result = await this.tasksService.assign(id, dto.assigned_user_id ?? null);
    return this.responseService.updated(result, 'Tarea asignada');
  }

  @ApiOperation({ summary: 'Marcar terminada una tarea de limpieza propia' })
  @Post('tasks/:id/complete')
  @Permissions('store:lodging:housekeeping:operate')
  async complete(@Param('id', ParseIntPipe) id: number) {
    const result = await this.tasksService.complete(id);
    return this.responseService.updated(result, 'Tarea terminada');
  }
}
