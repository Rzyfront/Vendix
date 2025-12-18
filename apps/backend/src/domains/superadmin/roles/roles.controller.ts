import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
  RemovePermissionsDto,
} from '../../organization/roles/dto/role.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ResponseService } from 'src/common/responses';

@ApiTags('Admin Roles')
@Controller('superadmin/roles')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly responseService: ResponseService,
  ) { }

  @Post()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  async create(@Body() createRoleDto: CreateRoleDto) {
    const role = await this.rolesService.create(createRoleDto);
    return this.responseService.created(role, 'Role created successfully');
  }

  @Get()
  @ApiOperation({ summary: 'Get all roles with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'Roles retrieved successfully' })
  async findAll(@Query() query: any) {
    const result = await this.rolesService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Roles retrieved successfully',
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics for roles' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  async getDashboardStats() {
    const stats = await this.rolesService.getDashboardStats();
    return this.responseService.success(
      stats,
      'Dashboard statistics retrieved successfully',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiResponse({ status: 200, description: 'Role retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async findOne(@Param('id') id: string) {
    const role = await this.rolesService.findOne(+id);
    return this.responseService.success(role, 'Role retrieved successfully');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a role' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    const role = await this.rolesService.update(+id, updateRoleDto);
    return this.responseService.updated(role, 'Role updated successfully');
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a role' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete system roles or roles with existing data',
  })
  async remove(@Param('id') id: string) {
    await this.rolesService.remove(+id);
    return this.responseService.deleted('Role deleted successfully');
  }

  @Post(':id/permissions')
  @ApiOperation({ summary: 'Assign permissions to a role' })
  @ApiResponse({
    status: 200,
    description: 'Permissions assigned successfully',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({
    status: 409,
    description: 'Some permissions are already assigned',
  })
  async assignPermissions(
    @Param('id') id: string,
    @Body() assignPermissionsDto: AssignPermissionsDto,
  ) {
    const result = await this.rolesService.assignPermissions(
      +id,
      assignPermissionsDto,
    );
    return this.responseService.success(
      result,
      'Permissions assigned successfully',
    );
  }

  @Delete(':id/permissions')
  @ApiOperation({ summary: 'Remove permissions from a role' })
  @ApiResponse({ status: 200, description: 'Permissions removed successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async removePermissions(
    @Param('id') id: string,
    @Body() removePermissionsDto: RemovePermissionsDto,
  ) {
    const result = await this.rolesService.removePermissions(
      +id,
      removePermissionsDto,
    );
    return this.responseService.success(
      result,
      'Permissions removed successfully',
    );
  }

  @Get(':id/permissions')
  @ApiOperation({ summary: 'Get permissions for a role' })
  @ApiResponse({
    status: 200,
    description: 'Role permissions retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async getPermissions(@Param('id') id: string) {
    const result = await this.rolesService.getPermissions(+id);
    return this.responseService.success(
      result,
      'Role permissions retrieved successfully',
    );
  }
}
