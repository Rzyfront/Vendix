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
  ResetPasswordDto,
  UserConfigDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';

@Controller('organization/users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly responseService: ResponseService,
  ) { }

  @Post()
  @Permissions('organization:users:create')
  async create(
    @Body() createUserDto: CreateUserDto,
    @Req() req: AuthenticatedRequest,
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
  @Permissions('organization:users:read')
  async findAll(
    @Query() query: UserQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
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
  @Permissions('organization:users:read')
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
  @Permissions('organization:users:read')
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

  @Get(':id/settings')
  @Permissions('organization:users:read')
  async findUserSettings(@Param('id', ParseIntPipe) id: number) {
    try {
      const user = await this.usersService.findUserSettings(id);
      return this.responseService.success(
        user,
        'Configuración de usuario obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la configuración del usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('organization:users:update')
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
  @Permissions('organization:users:delete')
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
  @Permissions('organization:users:delete')
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
  @Permissions('organization:users:update')
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

  @Post(':id/verify-email')
  @Permissions('organization:users:verify-email')
  async verifyEmail(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.usersService.verifyEmail(id);
      return this.responseService.success(
        result,
        'Email verificado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al verificar el email',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/reset-password')
  @Permissions('organization:users:reset-password')
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() resetPasswordDto: ResetPasswordDto,
  ) {
    try {
      const result = await this.usersService.resetPassword(
        id,
        resetPasswordDto,
      );
      return this.responseService.success(
        result,
        'Contraseña restablecida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al restablecer la contraseña',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id/configuration')
  @Permissions('organization:users:read')
  async getConfiguration(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.usersService.findConfiguration(id);
      return this.responseService.success(
        result,
        'Configuración de usuario obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la configuración del usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/configuration')
  @Permissions('organization:users:update')
  async updateConfiguration(
    @Param('id', ParseIntPipe) id: number,
    @Body() configDto: UserConfigDto,
  ) {
    try {
      const result = await this.usersService.updateConfiguration(id, configDto);
      return this.responseService.updated(
        result,
        'Configuración de usuario actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la configuración del usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
