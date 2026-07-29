import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RolesService } from './roles.service';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
  RemovePermissionsDto,
  AssignRoleToUserDto,
  RemoveRoleFromUserDto,
} from './dto/role.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ResponseService } from '@common/responses/response.service';

/**
 * QUI-72 — nivel ORGANIZACIÓN de la gestión de roles.
 *
 * Nota sobre errores: este controlador ya NO envuelve las llamadas en
 * try/catch. `ResponseService.error()` devuelve un objeto plano, así que el
 * status HTTP seguía siendo 200/201 y el `error_code` tipado se perdía: un
 * intento de editar un rol de sistema respondía "200 success:false", que la UI
 * interpretaba como guardado correcto. Dejando propagar la excepción, el
 * `AllExceptionsFilter` responde con el status real (403 `ROLE_SCOPE_001`,
 * 404 `ROLE_SCOPE_004`, 409 `ROLE_ASSIGN_005`, …) y su `error_code`.
 */
@ApiTags('Roles')
@ApiBearerAuth()
@Controller('organization/roles')
@UseGuards(PermissionsGuard)
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Crear un rol de organización, o de tienda enviando `store_id` (debe ser una tienda propia)',
  })
  @ApiResponse({ status: 201, description: 'Rol creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({
    status: 403,
    description: 'La tienda indicada no pertenece a la organización',
  })
  @ApiResponse({ status: 409, description: 'Ya existe un rol con este nombre' })
  async create(@Body() createRoleDto: CreateRoleDto, @Request() req) {
    const result = await this.rolesService.create(createRoleDto, req.user.id);
    return this.responseService.created(result, 'Rol creado exitosamente');
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Listar roles visibles: de sistema (sólo lectura), de la organización y de sus tiendas',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de roles obtenida exitosamente',
  })
  async findAll(@Request() req) {
    const result = await this.rolesService.findAll(req.user.id);
    return this.responseService.success(
      result,
      'Lista de roles obtenida exitosamente',
      req.url,
    );
  }

  // ===== DASHBOARD STATS =====

  @Get('stats')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Obtener estadísticas de roles' })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas exitosamente',
  })
  @ApiResponse({
    status: 403,
    description: 'No tienes permisos para ver estas estadísticas',
  })
  async getStats(@Request() req) {
    const result = await this.rolesService.getDashboardStats(req.user.id);
    return this.responseService.success(
      result,
      'Estadísticas obtenidas exitosamente',
      req.url,
    );
  }

  // ===== GESTIÓN DE PERMISOS =====

  @Get(':id/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @Permissions('organization:roles:permissions:read')
  @ApiOperation({ summary: 'Obtener IDs de permisos de un rol' })
  @ApiResponse({
    status: 200,
    description: 'IDs de permisos obtenidos exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async getRolePermissions(
    @Param('id', ParseIntPipe) id: number,
    @Request() req,
  ) {
    const result = await this.rolesService.getRolePermissions(id, req.user.id);
    return this.responseService.success(
      result,
      'IDs de permisos obtenidos exitosamente',
      req.url,
    );
  }

  @Post(':id/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Asignar permisos a un rol' })
  @ApiResponse({ status: 200, description: 'Permisos asignados exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({
    status: 403,
    description: 'El rol es de sólo lectura en este nivel',
  })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async assignPermissions(
    @Param('id', ParseIntPipe) roleId: number,
    @Body() assignPermissionsDto: AssignPermissionsDto,
    @Request() req,
  ) {
    const result = await this.rolesService.assignPermissions(
      roleId,
      assignPermissionsDto,
      req.user.id,
    );
    return this.responseService.success(
      result,
      'Permisos asignados exitosamente',
      req.url,
    );
  }

  @Delete(':id/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Remover permisos de un rol' })
  @ApiResponse({ status: 200, description: 'Permisos removidos exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({
    status: 403,
    description: 'El rol es de sólo lectura en este nivel',
  })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async removePermissions(
    @Param('id', ParseIntPipe) roleId: number,
    @Body() removePermissionsDto: RemovePermissionsDto,
    @Request() req,
  ) {
    const result = await this.rolesService.removePermissions(
      roleId,
      removePermissionsDto,
      req.user.id,
    );
    return this.responseService.success(
      result,
      'Permisos removidos exitosamente',
      req.url,
    );
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener un rol por ID' })
  @ApiResponse({ status: 200, description: 'Rol encontrado' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado o no visible' })
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    const result = await this.rolesService.findOne(id, req.user.id);
    return this.responseService.success(result, 'Rol encontrado', req.url);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar un rol' })
  @ApiResponse({ status: 200, description: 'Rol actualizado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({
    status: 403,
    description: 'El rol es de sólo lectura en este nivel (ROLE_SCOPE_001)',
  })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  @ApiResponse({ status: 409, description: 'Ya existe un rol con este nombre' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoleDto: UpdateRoleDto,
    @Request() req,
  ) {
    const result = await this.rolesService.update(
      id,
      updateRoleDto,
      req.user.id,
    );
    return this.responseService.updated(result, 'Rol actualizado exitosamente');
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Eliminar un rol' })
  @ApiResponse({ status: 200, description: 'Rol eliminado exitosamente' })
  @ApiResponse({ status: 400, description: 'No se puede eliminar el rol' })
  @ApiResponse({
    status: 403,
    description: 'El rol es de sólo lectura en este nivel',
  })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    const result = await this.rolesService.remove(id, req.user.id);
    return this.responseService.success(
      result,
      'Rol eliminado exitosamente',
      req.url,
    );
  }

  // ===== GESTIÓN DE USUARIOS =====
  //
  // Dirección rol → usuario. La dirección espejo (usuario → rol) vive en
  // `organization/users/:userId/roles/:roleId`; ambas delegan en
  // `UserRoleAssignmentService` para no divergir.

  @Post('assign-to-user')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Asignar un rol a un usuario (`store_id` opcional: NULL = toda la organización)',
  })
  @ApiResponse({ status: 201, description: 'Rol asignado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 403, description: 'Asignación fuera de alcance' })
  @ApiResponse({ status: 404, description: 'Usuario o rol no encontrado' })
  @ApiResponse({
    status: 409,
    description: 'El usuario ya tiene este rol en ese alcance',
  })
  async assignRoleToUser(
    @Body() assignRoleToUserDto: AssignRoleToUserDto,
    @Request() req,
  ) {
    const result = await this.rolesService.assignRoleToUser(
      assignRoleToUserDto,
      req.user.id,
    );
    return this.responseService.success(result, 'Rol asignado exitosamente');
  }

  @Post('remove-from-user')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Remover un rol de un usuario (`store_id` opcional: NULL = la asignación org-wide)',
  })
  @ApiResponse({ status: 200, description: 'Rol removido exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 403, description: 'Remoción fuera de alcance' })
  @ApiResponse({ status: 404, description: 'Relación no encontrada' })
  async removeRoleFromUser(
    @Body() removeRoleFromUserDto: RemoveRoleFromUserDto,
    @Request() req,
  ) {
    const result = await this.rolesService.removeRoleFromUser(
      removeRoleFromUserDto,
      req.user.id,
    );
    return this.responseService.success(
      result,
      'Rol removido exitosamente',
      req.url,
    );
  }

  // ===== UTILIDADES =====

  @Get('user/:userId/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener permisos de un usuario' })
  @ApiResponse({ status: 200, description: 'Permisos obtenidos exitosamente' })
  async getUserPermissions(
    @Param('userId', ParseIntPipe) userId: number,
    @Request() req,
  ) {
    const result = await this.rolesService.getUserPermissions(userId);
    return this.responseService.success(
      result,
      'Permisos obtenidos exitosamente',
      req.url,
    );
  }

  @Get('user/:userId/roles')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Obtener las asignaciones de roles de un usuario, cada una con su `store_id`',
  })
  @ApiResponse({ status: 200, description: 'Roles obtenidos exitosamente' })
  async getUserRoles(
    @Param('userId', ParseIntPipe) userId: number,
    @Request() req,
  ) {
    const result = await this.rolesService.getUserRoles(userId);
    return this.responseService.success(
      result,
      'Roles obtenidos exitosamente',
      req.url,
    );
  }
}
