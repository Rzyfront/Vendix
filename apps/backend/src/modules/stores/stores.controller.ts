import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { StoresService } from './stores.service';
import { CreateStoreDto, UpdateStoreDto, StoreQueryDto, AddStaffToStoreDto, UpdateStoreSettingsDto } from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../auth/guards';
import { Roles, RequirePermissions, CurrentUser } from '../../auth/decorators';

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.create')
  create(@Body() createStoreDto: CreateStoreDto, @CurrentUser() user: any) {
    return this.storesService.create(createStoreDto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.read')
  findAll(@Query() query: StoreQueryDto) {
    return this.storesService.findAll(query);
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.storesService.findOne(id);
  }

  @Get('organization/:organizationId/slug/:slug')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.read')
  findBySlug(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Param('slug') slug: string
  ) {
    return this.storesService.findBySlug(organizationId, slug);
  }

  @Get('organization/:organizationId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.read')
  getStoresByOrganization(@Param('organizationId', ParseIntPipe) organizationId: number) {
    return this.storesService.getStoresByOrganization(organizationId);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    return this.storesService.update(id, updateStoreDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'owner')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.storesService.remove(id);
  }

  // Endpoints para gestión de personal de tienda
  @Post(':id/staff')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.manage_staff')
  addStaff(
    @Param('id', ParseIntPipe) storeId: number,
    @Body() addStaffDto: AddStaffToStoreDto,
  ) {
    return this.storesService.addStaffToStore(storeId, addStaffDto);
  }

  @Delete(':storeId/staff/:userId/roles/:roleId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.manage_staff')
  removeStaff(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Param('roleId', ParseIntPipe) roleId: number,
  ) {
    return this.storesService.removeStaffFromStore(storeId, userId, roleId);
  }

  @Get(':id/staff')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.read')
  getStaff(@Param('id', ParseIntPipe) storeId: number) {
    return this.storesService.getStoreStaff(storeId);
  }

  // Endpoints para configuraciones de tienda
  @Patch(':id/settings')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.update')
  updateSettings(
    @Param('id', ParseIntPipe) storeId: number,
    @Body() settingsDto: UpdateStoreSettingsDto,
  ) {
    return this.storesService.updateStoreSettings(storeId, settingsDto);
  }

  @Get(':id/settings')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('stores.read')
  getSettings(@Param('id', ParseIntPipe) storeId: number) {
    return this.storesService.getStoreSettings(storeId);
  }
}
