import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request, ParseIntPipe, BadRequestException, NotFoundException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto, UpdatePermissionDto, PermissionFilterDto } from './dto/permission.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/enums/user-role.enum';
import { ResponseService } from '../../common/responses/response.service';

@ApiTags('Permissions')
@ApiBearerAuth()
@Controller('permissions')
@UseGuards(RolesGuard)
export class PermissionsController {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Crear un nuevo permiso' })
  @ApiResponse({ status: 201, description: 'Permiso creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 409, description: 'Ya existe un permiso con este nombre o ruta/método' })
  async create(@Body() createPermissionDto: CreatePermissionDto, @Request() req) {
    try {
      const result = await this.permissionsService.create(createPermissionDto, req.user.id);
      return this.responseService.success(
        result,
        'Permiso creado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al crear el permiso',
        error.message,
      );
    }
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener todos los permisos' })
  @ApiResponse({ status: 200, description: 'Lista de permisos obtenida exitosamente' })
  @ApiQuery({ name: 'method', required: false, enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'deprecated'] })
  @ApiQuery({ name: 'search', required: false, description: 'Buscar por nombre, descripción o ruta' })
  async findAll(
    @Query() filterDto: PermissionFilterDto,
    @Request() req
  ) {
    try {
      const result = await this.permissionsService.findAll(filterDto, req.user.id);
      return this.responseService.success(
        result,
        'Lista de permisos obtenida exitosamente',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener los permisos',
        error.message,
      );
    }
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Obtener un permiso por ID' })
  @ApiResponse({ status: 200, description: 'Permiso encontrado' })
  @ApiResponse({ status: 404, description: 'Permiso no encontrado' })
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    try {
      const result = await this.permissionsService.findOne(id, req.user.id);
      return this.responseService.success(
        result,
        'Permiso encontrado',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener el permiso',
        error.message,
      );
    }
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar un permiso' })
  @ApiResponse({ status: 200, description: 'Permiso actualizado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Permiso no encontrado' })
  @ApiResponse({ status: 409, description: 'Ya existe un permiso con este nombre o ruta/método' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePermissionDto: UpdatePermissionDto,
    @Request() req
  ) {
    try {
      const result = await this.permissionsService.update(id, updatePermissionDto, req.user.id);
      return this.responseService.success(
        result,
        'Permiso actualizado exitosamente',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al actualizar el permiso',
        error.message,
      );
    }
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Eliminar un permiso' })
  @ApiResponse({ status: 200, description: 'Permiso eliminado exitosamente' })
  @ApiResponse({ status: 400, description: 'No se puede eliminar el permiso' })
  @ApiResponse({ status: 404, description: 'Permiso no encontrado' })
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    try {
      const result = await this.permissionsService.remove(id, req.user.id);
      return this.responseService.success(
        result,
        'Permiso eliminado exitosamente',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al eliminar el permiso',
        error.message,
      );
    }
  }

  // ===== UTILIDADES =====

  @Get('search/by-name/:name')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Buscar permiso por nombre' })
  @ApiResponse({ status: 200, description: 'Permiso encontrado' })
  @ApiResponse({ status: 404, description: 'Permiso no encontrado' })
  async findByName(@Param('name') name: string, @Request() req) {
    try {
      const result = await this.permissionsService.findByName(name);
      if (!result) {
        throw new NotFoundException('Permiso no encontrado');
      }
      return this.responseService.success(
        result,
        'Permiso encontrado',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al buscar el permiso',
        error.message,
      );
    }
  }

  @Get('search/by-path-method')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Buscar permiso por ruta y método' })
  @ApiResponse({ status: 200, description: 'Permiso encontrado' })
  @ApiResponse({ status: 404, description: 'Permiso no encontrado' })
  @ApiQuery({ name: 'path', required: true, description: 'Ruta del endpoint' })
  @ApiQuery({ name: 'method', required: true, enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] })
  async findByPathAndMethod(
    @Query('path') path: string,
    @Query('method') method: string,
    @Request() req
  ) {
    try {
      if (!path || !method) {
        throw new BadRequestException('Se requieren los parámetros path y method');
      }
      const result = await this.permissionsService.findByPathAndMethod(path, method as any);
      if (!result) {
        throw new NotFoundException('Permiso no encontrado');
      }
      return this.responseService.success(
        result,
        'Permiso encontrado',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al buscar el permiso',
        error.message,
      );
    }
  }
}