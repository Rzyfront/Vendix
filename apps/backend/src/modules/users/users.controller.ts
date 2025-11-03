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
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  UpdateUserDto,
  UserQueryDto,
  UsersDashboardDto,
} from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequestContext } from '../../common/decorators/request-context.decorator';
import { ResponseService } from '../../common/responses/response.service';

@Controller('users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('users:create')
  async create(
    @Body() createUserDto: CreateUserDto,
    @RequestContext() currentUser: any,
  ) {
    try {
      const user = await this.usersService.create(createUserDto);
      return this.responseService.created(user, 'Usuario creado exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @Permissions('users:read')
  async findAll(@Query() query: UserQueryDto, @RequestContext() user: any) {
    try {
      const result = await this.usersService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Usuarios obtenidos exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Usuarios obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los usuarios',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('stats')
  @Permissions('users:read')
  async getStats(@Query() query: UsersDashboardDto) {
    try {
      const result = await this.usersService.getDashboard(query);
      return this.responseService.success(
        result.data,
        'Estadísticas de usuarios obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las estadísticas de usuarios',
        error.message,
      );
    }
  }

  @Get(':id')
  @Permissions('users:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const user = await this.usersService.findOne(id);
      return this.responseService.success(
        user,
        'Usuario obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('users:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    try {
      const result = await this.usersService.update(id, updateUserDto);
      return this.responseService.updated(
        result,
        'Usuario actualizado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('users:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.usersService.remove(id);
      return this.responseService.deleted('Usuario eliminado exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/archive')
  @Permissions('users:delete')
  async archive(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.usersService.archive(id);
      return this.responseService.success(
        result,
        'Usuario archivado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al archivar el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/reactivate')
  @Permissions('users:update')
  async reactivate(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.usersService.reactivate(id);
      return this.responseService.success(
        result,
        'Usuario reactivado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al reactivar el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
