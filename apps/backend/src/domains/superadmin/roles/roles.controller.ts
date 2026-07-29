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
  AssignPermissionsDto,
  RemovePermissionsDto,
} from '../../organization/roles/dto/role.dto';
import {
  RoleAssignmentScopeDto,
  SuperadminCreateRoleDto,
  SuperadminRoleQueryDto,
  SuperadminUpdateRoleDto,
} from './dto/role.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
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
  ) {}

  @Permissions('superadmin:roles:create')
  @Post()
  @ApiOperation({
    summary: 'Create a new role in any scope (system / organization / store)',
  })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  @ApiResponse({ status: 422, description: 'Incoherent role scope' })
  async create(@Body() createRoleDto: SuperadminCreateRoleDto) {
    const role = await this.rolesService.create(createRoleDto);
    return this.responseService.created(role, 'Role created successfully');
  }

  @Permissions('superadmin:roles:read')
  @Get()
  @ApiOperation({
    summary:
      'Get all roles across every tenant, with scope / organization / store filters',
  })
  @ApiResponse({ status: 200, description: 'Roles retrieved successfully' })
  async findAll(@Query() query: SuperadminRoleQueryDto) {
    const result = await this.rolesService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Roles retrieved successfully',
    );
  }

  @Permissions('superadmin:roles:read')
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

  @Permissions('superadmin:roles:read')
  @Get(':id')
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiResponse({ status: 200, description: 'Role retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async findOne(@Param('id') id: string) {
    const role = await this.rolesService.findOne(+id);
    return this.responseService.success(role, 'Role retrieved successfully');
  }

  @Permissions('superadmin:roles:update')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a role (including its scope)' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 422, description: 'Incoherent role scope' })
  async update(
    @Param('id') id: string,
    @Body() updateRoleDto: SuperadminUpdateRoleDto,
  ) {
    const role = await this.rolesService.update(+id, updateRoleDto);
    return this.responseService.updated(role, 'Role updated successfully');
  }

  @Permissions('superadmin:roles:delete')
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

  @Permissions('superadmin:roles:update')
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

  @Permissions('superadmin:roles:update')
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

  @Permissions('superadmin:roles:read')
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

  // ===== Dirección rol → usuarios (QUI-72) =====
  //
  // La dirección inversa vive en `superadmin/users/:userId/roles/:roleId`.
  // Ambas atraviesan `SuperadminRoleAssignmentService`, así que ninguna puede
  // escribir `user_roles` de forma que la otra no vea.

  @Permissions('superadmin:roles:read')
  @Get(':id/users')
  @ApiOperation({ summary: 'List the users assigned to a role' })
  @ApiResponse({ status: 200, description: 'Role users retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async listUsers(@Param('id') id: string) {
    const result = await this.rolesService.listRoleUsers(+id);
    return this.responseService.success(
      result,
      'Role users retrieved successfully',
    );
  }

  @Permissions('superadmin:roles:update')
  @Post(':id/users/:userId')
  @ApiOperation({
    summary:
      'Assign a role to a user. `store_id` (body or query) scopes the assignment to one store; absent or null means org-wide.',
  })
  @ApiResponse({ status: 200, description: 'Role assigned successfully' })
  @ApiResponse({ status: 404, description: 'Role or user not found' })
  @ApiResponse({ status: 409, description: 'Role already assigned' })
  async assignUser(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: RoleAssignmentScopeDto,
    @Query() query: RoleAssignmentScopeDto,
  ) {
    const result = await this.rolesService.assignUser(+id, +userId, {
      store_id: body?.store_id !== undefined ? body.store_id : query?.store_id,
    });
    return this.responseService.success(result, 'Role assigned successfully');
  }

  @Permissions('superadmin:roles:update')
  @Delete(':id/users/:userId')
  @ApiOperation({
    summary:
      'Remove a role from a user. `store_id` selects the store-scoped assignment; absent or null targets the org-wide one.',
  })
  @ApiResponse({ status: 200, description: 'Role removed successfully' })
  @ApiResponse({ status: 404, description: 'Assignment not found' })
  async removeUser(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Query() query: RoleAssignmentScopeDto,
  ) {
    const result = await this.rolesService.removeUser(+id, +userId, query);
    return this.responseService.success(result, 'Role removed successfully');
  }
}
