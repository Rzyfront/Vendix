import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StoreRolesService } from './store-roles.service';
import { ResponseService } from '../../../common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
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

  /**
   * QUI-72 — Los `catch` de este controlador envolvían TODO en un 200 con
   * `success:false`, así que un 403 de la matriz de alcance (ROLE_SCOPE_001) o
   * un 404 llegaban al cliente como respuesta exitosa. Los errores tipados se
   * re-lanzan para que `AllExceptionsFilter` emita el status y el `error_code`
   * reales; sólo lo inesperado conserva el envoltorio legacy.
   */
  private rethrowIfHttp(error: unknown): void {
    if (error instanceof HttpException) {
      throw error;
    }
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:read')
  @ApiOperation({ summary: 'List all roles (org + system)' })
  @ApiResponse({ status: 200, description: 'Roles retrieved successfully' })
  async findAll() {
    try {
      const result = await this.store_roles_service.findAll();
      return this.response_service.success(
        result,
        'Roles retrieved successfully',
      );
    } catch (error) {
      this.rethrowIfHttp(error);
      return this.response_service.error(
        'Error retrieving roles',
        error.message,
      );
    }
  }

  @Get('stats')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:read')
  @ApiOperation({ summary: 'Dashboard stats for roles' })
  @ApiResponse({ status: 200, description: 'Stats retrieved successfully' })
  async getStats() {
    try {
      const result = await this.store_roles_service.getStats();
      return this.response_service.success(
        result,
        'Stats retrieved successfully',
      );
    } catch (error) {
      this.rethrowIfHttp(error);
      return this.response_service.error(
        'Error retrieving stats',
        error.message,
      );
    }
  }

  @Get('permissions/available')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:read')
  @ApiOperation({ summary: 'List available store:* permissions' })
  @ApiResponse({
    status: 200,
    description: 'Permissions retrieved successfully',
  })
  async getAvailablePermissions() {
    try {
      const result = await this.store_roles_service.getAvailablePermissions();
      return this.response_service.success(
        result,
        'Permissions retrieved successfully',
      );
    } catch (error) {
      this.rethrowIfHttp(error);
      return this.response_service.error(
        'Error retrieving permissions',
        error.message,
      );
    }
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:read')
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiResponse({ status: 200, description: 'Role found' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.store_roles_service.findOne(id);
      return this.response_service.success(result, 'Role found');
    } catch (error) {
      this.rethrowIfHttp(error);
      return this.response_service.error(
        'Error retrieving role',
        error.message,
      );
    }
  }

  @Get(':id/permissions')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:read')
  @ApiOperation({ summary: 'Get permission IDs of a role' })
  @ApiResponse({
    status: 200,
    description: 'Permission IDs retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async getRolePermissions(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.store_roles_service.getRolePermissions(id);
      return this.response_service.success(
        result,
        'Permission IDs retrieved successfully',
      );
    } catch (error) {
      this.rethrowIfHttp(error);
      return this.response_service.error(
        'Error retrieving role permissions',
        error.message,
      );
    }
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:update')
  @ApiOperation({ summary: 'Create a custom role' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  async create(@Body() dto: CreateStoreRoleDto) {
    try {
      const result = await this.store_roles_service.create(dto);
      return this.response_service.created(result, 'Role created successfully');
    } catch (error) {
      this.rethrowIfHttp(error);
      return this.response_service.error('Error creating role', error.message);
    }
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:update')
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
      this.rethrowIfHttp(error);
      return this.response_service.error('Error updating role', error.message);
    }
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:update')
  @ApiOperation({ summary: 'Delete a role' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  @ApiResponse({ status: 403, description: 'System roles cannot be deleted' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.store_roles_service.remove(id);
      return this.response_service.success(result, 'Role deleted successfully');
    } catch (error) {
      this.rethrowIfHttp(error);
      return this.response_service.error('Error deleting role', error.message);
    }
  }

  @Post(':id/permissions')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:update')
  @ApiOperation({ summary: 'Assign store:* permissions to a role' })
  @ApiResponse({
    status: 200,
    description: 'Permissions assigned successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Cannot modify system role permissions',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async assignPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignPermissionsDto,
  ) {
    try {
      const result = await this.store_roles_service.assignPermissions(id, dto);
      return this.response_service.success(
        result,
        'Permissions assigned successfully',
      );
    } catch (error) {
      this.rethrowIfHttp(error);
      return this.response_service.error(
        'Error assigning permissions',
        error.message,
      );
    }
  }

  @Delete(':id/permissions')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:update')
  @ApiOperation({ summary: 'Remove permissions from a role' })
  @ApiResponse({ status: 200, description: 'Permissions removed successfully' })
  @ApiResponse({
    status: 403,
    description: 'Cannot modify system role permissions',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async removePermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RemovePermissionsDto,
  ) {
    try {
      const result = await this.store_roles_service.removePermissions(id, dto);
      return this.response_service.success(
        result,
        'Permissions removed successfully',
      );
    } catch (error) {
      this.rethrowIfHttp(error);
      return this.response_service.error(
        'Error removing permissions',
        error.message,
      );
    }
  }

  // ─── Rol → Usuarios (QUI-72) ────────────────────────────────────────
  //
  // Dirección que el nivel tienda no tenía: administrar los usuarios DE un rol.
  // Sin try/catch a propósito: estos endpoints nacen con la semántica correcta
  // (403/404/409 tipados vía AllExceptionsFilter), no con el 200 legacy.
  //
  // `PermissionsGuard` se aplica por método: el guard NO es global y añadirlo a
  // nivel de clase no cambiaría nada para los handlers sin `@Permissions`, pero
  // dejarlo explícito aquí documenta que sólo estos tres exigen autorización.
  // Se reutiliza `store:users:*` (ya sembrado) porque esto administra la
  // pertenencia de USUARIOS: no requiere sembrar permisos nuevos y hereda la
  // decisión de negocio de que manager no administra usuarios.

  @Get(':id/users')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:read')
  @ApiOperation({ summary: 'List users assigned to a role in this store' })
  @ApiResponse({ status: 200, description: 'Role users retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Role not found or not visible' })
  async listRoleUsers(@Param('id', ParseIntPipe) id: number) {
    const result = await this.store_roles_service.listRoleUsers(id);
    return this.response_service.success(
      result,
      'Role users retrieved successfully',
    );
  }

  @Post(':id/users/:userId')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:update')
  @ApiOperation({ summary: 'Assign a role to a user in this store' })
  @ApiResponse({ status: 201, description: 'Role assigned successfully' })
  @ApiResponse({ status: 403, description: 'Role is not assignable here' })
  @ApiResponse({ status: 409, description: 'Role already assigned' })
  async assignRoleToUser(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    const result = await this.store_roles_service.assignRoleToUser(id, userId);
    return this.response_service.created(result, 'Role assigned successfully');
  }

  @Delete(':id/users/:userId')
  @UseGuards(PermissionsGuard)
  @Permissions('store:users:update')
  @ApiOperation({ summary: 'Remove a role from a user in this store' })
  @ApiResponse({ status: 200, description: 'Role removed successfully' })
  @ApiResponse({ status: 403, description: 'Role is not assignable here' })
  @ApiResponse({ status: 404, description: 'Assignment not found' })
  async removeRoleFromUser(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    const result = await this.store_roles_service.removeRoleFromUser(
      id,
      userId,
    );
    return this.response_service.success(result, 'Role removed successfully');
  }
}
