import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { StoreRolesService } from './store-roles.service';
import { ResponseService } from '../../../common/responses/response.service';
import {
  CreateStoreRoleDto,
  UpdateStoreRoleDto,
  AssignPermissionsDto,
  RemovePermissionsDto,
} from './dto/store-role.dto';

@ApiTags('Store Roles')
@ApiBearerAuth()
@Controller('store/roles')
export class StoreRolesController {
  constructor(
    private readonly store_roles_service: StoreRolesService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all roles (org + system)' })
  @ApiResponse({ status: 200, description: 'Roles retrieved successfully' })
  async findAll() {
    try {
      const result = await this.store_roles_service.findAll();
      return this.response_service.success(result, 'Roles retrieved successfully');
    } catch (error) {
      return this.response_service.error('Error retrieving roles', error.message);
    }
  }

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard stats for roles' })
  @ApiResponse({ status: 200, description: 'Stats retrieved successfully' })
  async getStats() {
    try {
      const result = await this.store_roles_service.getStats();
      return this.response_service.success(result, 'Stats retrieved successfully');
    } catch (error) {
      return this.response_service.error('Error retrieving stats', error.message);
    }
  }

  @Get('permissions/available')
  @ApiOperation({ summary: 'List available store:* permissions' })
  @ApiResponse({ status: 200, description: 'Permissions retrieved successfully' })
  async getAvailablePermissions() {
    try {
      const result = await this.store_roles_service.getAvailablePermissions();
      return this.response_service.success(result, 'Permissions retrieved successfully');
    } catch (error) {
      return this.response_service.error('Error retrieving permissions', error.message);
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiResponse({ status: 200, description: 'Role found' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.store_roles_service.findOne(id);
      return this.response_service.success(result, 'Role found');
    } catch (error) {
      return this.response_service.error('Error retrieving role', error.message);
    }
  }

  @Get(':id/permissions')
  @ApiOperation({ summary: 'Get permission IDs of a role' })
  @ApiResponse({ status: 200, description: 'Permission IDs retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async getRolePermissions(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.store_roles_service.getRolePermissions(id);
      return this.response_service.success(result, 'Permission IDs retrieved successfully');
    } catch (error) {
      return this.response_service.error('Error retrieving role permissions', error.message);
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom role' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  async create(@Body() dto: CreateStoreRoleDto) {
    try {
      const result = await this.store_roles_service.create(dto);
      return this.response_service.created(result, 'Role created successfully');
    } catch (error) {
      return this.response_service.error('Error creating role', error.message);
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a role' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 403, description: 'System roles cannot be modified' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStoreRoleDto,
  ) {
    try {
      const result = await this.store_roles_service.update(id, dto);
      return this.response_service.updated(result, 'Role updated successfully');
    } catch (error) {
      return this.response_service.error('Error updating role', error.message);
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a role' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  @ApiResponse({ status: 403, description: 'System roles cannot be deleted' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.store_roles_service.remove(id);
      return this.response_service.success(result, 'Role deleted successfully');
    } catch (error) {
      return this.response_service.error('Error deleting role', error.message);
    }
  }

  @Post(':id/permissions')
  @ApiOperation({ summary: 'Assign store:* permissions to a role' })
  @ApiResponse({ status: 200, description: 'Permissions assigned successfully' })
  @ApiResponse({ status: 403, description: 'Cannot modify system role permissions' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async assignPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignPermissionsDto,
  ) {
    try {
      const result = await this.store_roles_service.assignPermissions(id, dto);
      return this.response_service.success(result, 'Permissions assigned successfully');
    } catch (error) {
      return this.response_service.error('Error assigning permissions', error.message);
    }
  }

  @Delete(':id/permissions')
  @ApiOperation({ summary: 'Remove permissions from a role' })
  @ApiResponse({ status: 200, description: 'Permissions removed successfully' })
  @ApiResponse({ status: 403, description: 'Cannot modify system role permissions' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async removePermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RemovePermissionsDto,
  ) {
    try {
      const result = await this.store_roles_service.removePermissions(id, dto);
      return this.response_service.success(result, 'Permissions removed successfully');
    } catch (error) {
      return this.response_service.error('Error removing permissions', error.message);
    }
  }
}
