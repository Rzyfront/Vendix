import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StoreUsersService } from './store-users.service';
import { QueryStoreUsersDto } from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
// import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';

@Controller('store/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StoreUsersController {
  constructor(
    private readonly storeUsersService: StoreUsersService,
    private readonly responseService: ResponseService,
  ) { }

  @Get()
  // @RequirePermissions('store:users:read') // Uncomment when permission is defined
  async findAll(@Query() query: QueryStoreUsersDto) {
    const result = await this.storeUsersService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }
}
