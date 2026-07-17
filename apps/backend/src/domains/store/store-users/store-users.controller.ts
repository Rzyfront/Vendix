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
  UpdateUserRolesDto,
  UpdateUserPanelUIDto,
  SetCarrierTariffDto,
} from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
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
  @Permissions('store:users:read')
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
  @Permissions('store:users:read')
  async getStats() {
    const result = await this.storeUserManagementService.getStats();
    return this.responseService.success(result);
  }

  @Get('management')
  @Permissions('store:users:read')
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
  @Permissions('store:users:read')
  async managementFindOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.storeUserManagementService.findOne(id);
    return this.responseService.success(result);
  }

  @Post('management')
  @Permissions('store:users:create')
  async managementCreate(@Body() dto: CreateStoreUserDto) {
    const result = await this.storeUserManagementService.create(dto);
    return this.responseService.success(result, 'User created successfully');
  }

  @Patch('management/:id')
  @Permissions('store:users:update')
  async managementUpdate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStoreUserDto,
  ) {
    const result = await this.storeUserManagementService.update(id, dto);
    return this.responseService.success(result, 'User updated successfully');
  }

  @Post('management/:id/deactivate')
  @Permissions('store:users:update')
  async managementDeactivate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.storeUserManagementService.deactivate(id);
    return this.responseService.success(
      result,
      'User deactivated successfully',
    );
  }

  @Post('management/:id/reactivate')
  @Permissions('store:users:update')
  async managementReactivate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.storeUserManagementService.reactivate(id);
    return this.responseService.success(
      result,
      'User reactivated successfully',
    );
  }

  @Patch('management/:id/roles')
  @Permissions('store:users:update')
  async managementUpdateRoles(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserRolesDto,
  ) {
    const result = await this.storeUserManagementService.updateRoles(id, dto);
    return this.responseService.success(result, 'Roles updated successfully');
  }

  @Patch('management/:id/panel-ui')
  @Permissions('store:users:update')
  async managementUpdatePanelUI(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserPanelUIDto,
  ) {
    const result = await this.storeUserManagementService.updatePanelUI(id, dto);
    return this.responseService.success(
      result,
      'Panel UI updated successfully',
    );
  }

  @Post('management/:id/reset-password')
  @Permissions('store:users:update')
  async managementResetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordStoreUserDto,
  ) {
    await this.storeUserManagementService.resetPassword(id, dto);
    return this.responseService.success(null, 'Password reset successfully');
  }

  // Vendix Repartos (B8): tarifa configurable por repartidor. Persiste en
  // user_settings.config.carrier_tariff vía MERGE (no pisa el resto del config).
  @Patch('management/:id/carrier-tariff')
  @Permissions('store:users:update')
  async managementSetCarrierTariff(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetCarrierTariffDto,
  ) {
    const result = await this.storeUserManagementService.setCarrierTariff(
      id,
      dto,
    );
    return this.responseService.success(
      result,
      'Carrier tariff updated successfully',
    );
  }
}
