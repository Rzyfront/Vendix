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
import { AdminUsersService } from './admin-users.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from '../users/dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ResponseService } from '../../common/responses/response.service';

@ApiTags('Admin Users')
@Controller('admin/users')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async create(@Body() createUserDto: CreateUserDto) {
    try {
      const result = await this.adminUsersService.create(createUserDto);
      return this.responseService.created(
        result,
        'Usuario creado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all users with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  async findAll(@Query() query: UserQueryDto) {
    try {
      const result = await this.adminUsersService.findAll(query);
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

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics for users' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  async getDashboardStats() {
    try {
      const result = await this.adminUsersService.getDashboardStats();
      return this.responseService.success(
        result,
        'Estadísticas del dashboard obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las estadísticas del dashboard',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({ status: 200, description: 'User retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string) {
    try {
      const result = await this.adminUsersService.findOne(+id);
      return this.responseService.success(
        result,
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
  @ApiOperation({ summary: 'Update a user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    try {
      const result = await this.adminUsersService.update(+id, updateUserDto);
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
  @ApiOperation({ summary: 'Delete a user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({
    status: 403,
    description: 'Cannot delete super admin users',
  })
  async remove(@Param('id') id: string) {
    try {
      await this.adminUsersService.remove(+id);
      return this.responseService.deleted('Usuario eliminado exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate a user' })
  @ApiResponse({ status: 200, description: 'User activated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async activate(@Param('id') id: string) {
    try {
      const result = await this.adminUsersService.activateUser(+id);
      return this.responseService.success(
        result,
        'Usuario activado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al activar el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a user' })
  @ApiResponse({ status: 200, description: 'User deactivated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deactivate(@Param('id') id: string) {
    try {
      const result = await this.adminUsersService.deactivateUser(+id);
      return this.responseService.success(
        result,
        'Usuario desactivado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al desactivar el usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':userId/roles/:roleId')
  @ApiOperation({ summary: 'Assign a role to a user' })
  @ApiResponse({ status: 200, description: 'Role assigned successfully' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  @ApiResponse({ status: 409, description: 'Role already assigned to user' })
  async assignRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ) {
    try {
      const result = await this.adminUsersService.assignRole(+userId, +roleId);
      return this.responseService.success(result, 'Rol asignado exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al asignar el rol',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':userId/roles/:roleId')
  @ApiOperation({ summary: 'Remove a role from a user' })
  @ApiResponse({ status: 200, description: 'Role removed successfully' })
  @ApiResponse({
    status: 404,
    description: 'User, role, or assignment not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Cannot remove super admin role',
  })
  async removeRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ) {
    try {
      const result = await this.adminUsersService.removeRole(+userId, +roleId);
      return this.responseService.success(result, 'Rol removido exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al remover el rol',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
