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
import { ResponseService } from '../../common/responses/response.service';
import { StoresService } from './stores.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  StoreQueryDto,
  UpdateStoreSettingsDto,
  StoreDashboardDto,
} from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';

@Controller('stores')
@UseGuards(PermissionsGuard)
export class StoresController {
  constructor(
    private readonly storesService: StoresService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('stores:create')
  create(@Body() createStoreDto: CreateStoreDto) {
    return this.storesService.create(createStoreDto);
  }

  @Get()
  @Permissions('stores:read')
  findAll(@Query() query: StoreQueryDto) {
    return this.storesService.findAll(query);
  }

  @Get(':id')
  @Permissions('stores:read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.storesService.findOne(id);
  }

  @Patch(':id')
  @Permissions('stores:update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    return this.storesService.update(id, updateStoreDto);
  }

  @Delete(':id')
  @Permissions('stores:delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.storesService.remove(id);
  }

  @Patch(':id/settings')
  @Permissions('stores:update')
  updateSettings(
    @Param('id', ParseIntPipe) storeId: number,
    @Body() settingsDto: UpdateStoreSettingsDto,
  ) {
    return this.storesService.updateStoreSettings(storeId, settingsDto);
  }

  @Get(':id/dashboard')
  @Permissions('stores:read')
  async getDashboard(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: StoreDashboardDto
  ) {
    try {
      const result = await this.storesService.getDashboard(id, query);
      return this.responseService.success(
        result,
        'Dashboard de tienda obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener el dashboard de tienda',
        error.message,
      );
    }
  }
}
