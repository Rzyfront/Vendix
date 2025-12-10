import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StoreUsersService } from './store-users.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/store-users')
@UseGuards(PermissionsGuard)
export class StoreUsersController {
  constructor(
    private readonly storeUsersService: StoreUsersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:users:read')
  async getStoreUsers() {
    try {
      const users = await this.storeUsersService.findAll();
      return this.responseService.success(
        users,
        'Usuarios de tienda obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener usuarios de tienda',
        error.message,
      );
    }
  }
}
