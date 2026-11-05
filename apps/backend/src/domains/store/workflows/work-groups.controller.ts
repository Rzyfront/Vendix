import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../common/decorators/industry-module.decorator';
import {
  CreateWorkGroupDto,
  UpdateWorkGroupDto,
  WorkGroupMemberDto,
} from './dto/work-group.dto';
import { WorkGroupsService } from './work-groups.service';

/** Work groups (assignees of workflow stages) and their members. */
@Controller('store/work-groups')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkGroupsController {
  constructor(
    private readonly groups: WorkGroupsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:read')
  async list() {
    return this.responseService.success(await this.groups.list());
  }

  @Get(':id')
  @Permissions('store:workflows:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.groups.get(id));
  }

  @Post()
  @Permissions('store:work_groups:manage')
  async create(@Body() dto: CreateWorkGroupDto) {
    return this.responseService.created(await this.groups.create(dto));
  }

  @Patch(':id')
  @Permissions('store:work_groups:manage')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkGroupDto) {
    return this.responseService.updated(await this.groups.update(id, dto));
  }

  @Put(':id/members/:userId')
  @Permissions('store:work_groups:manage')
  async setMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: WorkGroupMemberDto,
  ) {
    return this.responseService.updated(
      await this.groups.setMember(id, { user_id: userId, ...dto }),
    );
  }

  @Delete(':id/members/:userId')
  @Permissions('store:work_groups:manage')
  async removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.responseService.success(await this.groups.removeMember(id, userId));
  }
}
