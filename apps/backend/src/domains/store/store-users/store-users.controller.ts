import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { StoreUsersService } from './store-users.service';
import { StoreUserManagementService } from './store-user-management.service';
import {
  QueryStoreUsersDto,
  CreateStoreUserDto,
  UpdateStoreUserDto,
  ResetPasswordStoreUserDto,
} from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StoreUsersController {
  constructor(
    private readonly storeUsersService: StoreUsersService,
    private readonly storeUserManagementService: StoreUserManagementService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  async findAll(@Query() query: QueryStoreUsersDto) {
    const result = await this.storeUsersService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // ─── Management Endpoints ───────────────────────────────────────────

  @Get('management/stats')
  async getStats() {
    const result = await this.storeUserManagementService.getStats();
    return this.responseService.success(result);
  }

  @Get('management')
  async managementFindAll(@Query() query: QueryStoreUsersDto) {
    const result = await this.storeUserManagementService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Get('management/:id')
  async managementFindOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.storeUserManagementService.findOne(id);
    return this.responseService.success(result);
  }

  @Post('management')
  async managementCreate(@Body() dto: CreateStoreUserDto) {
    const result = await this.storeUserManagementService.create(dto);
    return this.responseService.success(result, 'User created successfully');
  }

  @Patch('management/:id')
  async managementUpdate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStoreUserDto,
  ) {
    const result = await this.storeUserManagementService.update(id, dto);
    return this.responseService.success(result, 'User updated successfully');
  }

  @Post('management/:id/deactivate')
  async managementDeactivate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.storeUserManagementService.deactivate(id);
    return this.responseService.success(result, 'User deactivated successfully');
  }

  @Post('management/:id/reactivate')
  async managementReactivate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.storeUserManagementService.reactivate(id);
    return this.responseService.success(result, 'User reactivated successfully');
  }

  @Post('management/:id/reset-password')
  async managementResetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordStoreUserDto,
  ) {
    await this.storeUserManagementService.resetPassword(id, dto);
    return this.responseService.success(null, 'Password reset successfully');
  }
}
