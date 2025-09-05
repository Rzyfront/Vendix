import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto, RemovePermissionsDto, AssignRoleToUserDto, RemoveRoleFromUserDto } from './dto/role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/enums/user-role.enum';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Crear un nuevo rol' })
  @ApiResponse({ status: 201, description: 'Rol creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 409, description: 'Ya existe un rol con este nombre' })
  create(@Body() createRoleDto: CreateRoleDto, @Request() req) {
    return this.rolesService.create(createRoleDto, req.user.id);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener todos los roles' })
  @ApiResponse({ status: 200, description: 'Lista de roles obtenida exitosamente' })
  findAll(@Request() req) {
    return this.rolesService.findAll(req.user.id);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener un rol por ID' })
  @ApiResponse({ status: 200, description: 'Rol encontrado' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.rolesService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar un rol' })
  @ApiResponse({ status: 200, description: 'Rol actualizado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  @ApiResponse({ status: 409, description: 'Ya existe un rol con este nombre' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoleDto: UpdateRoleDto,
    @Request() req
  ) {
    return this.rolesService.update(id, updateRoleDto, req.user.id);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Eliminar un rol' })
  @ApiResponse({ status: 200, description: 'Rol eliminado exitosamente' })
  @ApiResponse({ status: 400, description: 'No se puede eliminar el rol' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.rolesService.remove(id, req.user.id);
  }

  // ===== GESTIÓN DE PERMISOS =====

  @Post(':id/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Asignar permisos a un rol' })
  @ApiResponse({ status: 200, description: 'Permisos asignados exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  assignPermissions(
    @Param('id', ParseIntPipe) roleId: number,
    @Body() assignPermissionsDto: AssignPermissionsDto,
    @Request() req
  ) {
    return this.rolesService.assignPermissions(roleId, assignPermissionsDto, req.user.id);
  }

  @Delete(':id/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Remover permisos de un rol' })
  @ApiResponse({ status: 200, description: 'Permisos removidos exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  removePermissions(
    @Param('id', ParseIntPipe) roleId: number,
    @Body() removePermissionsDto: RemovePermissionsDto,
    @Request() req
  ) {
    return this.rolesService.removePermissions(roleId, removePermissionsDto, req.user.id);
  }

  // ===== GESTIÓN DE USUARIOS =====

  @Post('assign-to-user')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Asignar un rol a un usuario' })
  @ApiResponse({ status: 201, description: 'Rol asignado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Usuario o rol no encontrado' })
  @ApiResponse({ status: 409, description: 'El usuario ya tiene este rol' })
  assignRoleToUser(@Body() assignRoleToUserDto: AssignRoleToUserDto, @Request() req) {
    return this.rolesService.assignRoleToUser(assignRoleToUserDto, req.user.id);
  }

  @Post('remove-from-user')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Remover un rol de un usuario' })
  @ApiResponse({ status: 200, description: 'Rol removido exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Relación no encontrada' })
  removeRoleFromUser(@Body() removeRoleFromUserDto: RemoveRoleFromUserDto, @Request() req) {
    return this.rolesService.removeRoleFromUser(removeRoleFromUserDto, req.user.id);
  }

  // ===== UTILIDADES =====

  @Get('user/:userId/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener permisos de un usuario' })
  @ApiResponse({ status: 200, description: 'Permisos obtenidos exitosamente' })
  getUserPermissions(@Param('userId', ParseIntPipe) userId: number) {
    return this.rolesService.getUserPermissions(userId);
  }

  @Get('user/:userId/roles')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener roles de un usuario' })
  @ApiResponse({ status: 200, description: 'Roles obtenidos exitosamente' })
  getUserRoles(@Param('userId', ParseIntPipe) userId: number) {
    return this.rolesService.getUserRoles(userId);
  }
}
