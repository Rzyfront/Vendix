import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, ParseIntPipe, BadRequestException, NotFoundException, ConflictException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto, RemovePermissionsDto, AssignRoleToUserDto, RemoveRoleFromUserDto } from './dto/role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/enums/user-role.enum';
import { ResponseService } from '../../common/responses/response.service';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Crear un nuevo rol' })
  @ApiResponse({ status: 201, description: 'Rol creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 409, description: 'Ya existe un rol con este nombre' })
  async create(@Body() createRoleDto: CreateRoleDto, @Request() req) {
    try {
      const result = await this.rolesService.create(createRoleDto, req.user.id);
      return this.responseService.created(
        result,
        'Rol creado exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        throw this.responseService.conflict(
          'Ya existe un rol con este nombre',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'Datos inválidos',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error interno del servidor',
        error.message,
        req.url,
      );
    }
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener todos los roles' })
  @ApiResponse({ status: 200, description: 'Lista de roles obtenida exitosamente' })
  async findAll(@Request() req) {
    try {
      const result = await this.rolesService.findAll(req.user.id);
      return this.responseService.success(
        result,
        'Lista de roles obtenida exitosamente',
        req.url,
      );
    } catch (error) {
      throw this.responseService.internalServerError(
        'Error al obtener los roles',
        error.message,
        req.url,
      );
    }
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener un rol por ID' })
  @ApiResponse({ status: 200, description: 'Rol encontrado' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    try {
      const result = await this.rolesService.findOne(id, req.user.id);
      return this.responseService.success(
        result,
        'Rol encontrado',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Rol no encontrado',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al obtener el rol',
        error.message,
        req.url,
      );
    }
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar un rol' })
  @ApiResponse({ status: 200, description: 'Rol actualizado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  @ApiResponse({ status: 409, description: 'Ya existe un rol con este nombre' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoleDto: UpdateRoleDto,
    @Request() req
  ) {
    try {
      const result = await this.rolesService.update(id, updateRoleDto, req.user.id);
      return this.responseService.success(
        result,
        'Rol actualizado exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Rol no encontrado',
          error.message,
          req.url,
        );
      }
      if (error instanceof ConflictException) {
        throw this.responseService.conflict(
          'Ya existe un rol con este nombre',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'Datos inválidos',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al actualizar el rol',
        error.message,
        req.url,
      );
    }
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Eliminar un rol' })
  @ApiResponse({ status: 200, description: 'Rol eliminado exitosamente' })
  @ApiResponse({ status: 400, description: 'No se puede eliminar el rol' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    try {
      const result = await this.rolesService.remove(id, req.user.id);
      return this.responseService.success(
        result,
        'Rol eliminado exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Rol no encontrado',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'No se puede eliminar el rol',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al eliminar el rol',
        error.message,
        req.url,
      );
    }
  }

  // ===== GESTIÓN DE PERMISOS =====

  @Post(':id/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Asignar permisos a un rol' })
  @ApiResponse({ status: 200, description: 'Permisos asignados exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async assignPermissions(
    @Param('id', ParseIntPipe) roleId: number,
    @Body() assignPermissionsDto: AssignPermissionsDto,
    @Request() req
  ) {
    try {
      const result = await this.rolesService.assignPermissions(roleId, assignPermissionsDto, req.user.id);
      return this.responseService.success(
        result,
        'Permisos asignados exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Rol no encontrado',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'Datos inválidos',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al asignar permisos',
        error.message,
        req.url,
      );
    }
  }

  @Delete(':id/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Remover permisos de un rol' })
  @ApiResponse({ status: 200, description: 'Permisos removidos exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async removePermissions(
    @Param('id', ParseIntPipe) roleId: number,
    @Body() removePermissionsDto: RemovePermissionsDto,
    @Request() req
  ) {
    try {
      const result = await this.rolesService.removePermissions(roleId, removePermissionsDto, req.user.id);
      return this.responseService.success(
        result,
        'Permisos removidos exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Rol no encontrado',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'Datos inválidos',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al remover permisos',
        error.message,
        req.url,
      );
    }
  }

  // ===== GESTIÓN DE USUARIOS =====

  @Post('assign-to-user')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Asignar un rol a un usuario' })
  @ApiResponse({ status: 201, description: 'Rol asignado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Usuario o rol no encontrado' })
  @ApiResponse({ status: 409, description: 'El usuario ya tiene este rol' })
  async assignRoleToUser(@Body() assignRoleToUserDto: AssignRoleToUserDto, @Request() req) {
    try {
      const result = await this.rolesService.assignRoleToUser(assignRoleToUserDto, req.user.id);
      return this.responseService.created(
        result,
        'Rol asignado exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Usuario o rol no encontrado',
          error.message,
          req.url,
        );
      }
      if (error instanceof ConflictException) {
        throw this.responseService.conflict(
          'El usuario ya tiene este rol',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'Datos inválidos',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al asignar el rol al usuario',
        error.message,
        req.url,
      );
    }
  }

  @Post('remove-from-user')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Remover un rol de un usuario' })
  @ApiResponse({ status: 200, description: 'Rol removido exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Relación no encontrada' })
  async removeRoleFromUser(@Body() removeRoleFromUserDto: RemoveRoleFromUserDto, @Request() req) {
    try {
      const result = await this.rolesService.removeRoleFromUser(removeRoleFromUserDto, req.user.id);
      return this.responseService.success(
        result,
        'Rol removido exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Relación no encontrada',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'Datos inválidos',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al remover el rol del usuario',
        error.message,
        req.url,
      );
    }
  }

  // ===== UTILIDADES =====

  @Get('user/:userId/permissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener permisos de un usuario' })
  @ApiResponse({ status: 200, description: 'Permisos obtenidos exitosamente' })
  async getUserPermissions(@Param('userId', ParseIntPipe) userId: number, @Request() req) {
    try {
      const result = await this.rolesService.getUserPermissions(userId);
      return this.responseService.success(
        result,
        'Permisos obtenidos exitosamente',
        req.url,
      );
    } catch (error) {
      throw this.responseService.internalServerError(
        'Error al obtener los permisos del usuario',
        error.message,
        req.url,
      );
    }
  }

  @Get('user/:userId/roles')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener roles de un usuario' })
  @ApiResponse({ status: 200, description: 'Roles obtenidos exitosamente' })
  async getUserRoles(@Param('userId', ParseIntPipe) userId: number, @Request() req) {
    try {
      const result = await this.rolesService.getUserRoles(userId);
      return this.responseService.success(
        result,
        'Roles obtenidos exitosamente',
        req.url,
      );
    } catch (error) {
      throw this.responseService.internalServerError(
        'Error al obtener los roles del usuario',
        error.message,
        req.url,
      );
    }
  }
}
