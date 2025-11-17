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
import { AdminStoresService } from './admin-stores.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  AdminStoreQueryDto,
} from 'src/modules/stores/dto';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/modules/auth/guards/roles.guard';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { UserRole } from 'src/modules/auth/enums/user-role.enum';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ResponseService } from 'src/common/responses/response.service';

@ApiTags('Admin Stores')
@Controller('admin/stores')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminStoresController {
  constructor(
    private readonly adminStoresService: AdminStoresService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new store' })
  @ApiResponse({ status: 201, description: 'Store created successfully' })
  async create(@Body() createStoreDto: CreateStoreDto) {
    const result = await this.adminStoresService.create(createStoreDto);
    return this.responseService.created(result, 'Store created successfully');
  }

  @Get()
  @ApiOperation({ summary: 'Get all stores with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'Stores retrieved successfully' })
  async findAll(@Query() query: AdminStoreQueryDto) {
    const result = await this.adminStoresService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Stores retrieved successfully',
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics for stores' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  async getDashboardStats() {
    const stats = await this.adminStoresService.getDashboardStats();
    return this.responseService.success(
      stats,
      'Dashboard statistics retrieved successfully',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a store by ID' })
  @ApiResponse({ status: 200, description: 'Store retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async findOne(@Param('id') id: string) {
    const store = await this.adminStoresService.findOne(+id);
    return this.responseService.success(store, 'Store retrieved successfully');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a store' })
  @ApiResponse({ status: 200, description: 'Store updated successfully' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async update(
    @Param('id') id: string,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    const store = await this.adminStoresService.update(+id, updateStoreDto);
    return this.responseService.updated(store, 'Store updated successfully');
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a store' })
  @ApiResponse({ status: 200, description: 'Store deleted successfully' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete store with existing data',
  })
  async remove(@Param('id') id: string) {
    await this.adminStoresService.remove(+id);
    return this.responseService.deleted('Store deleted successfully');
  }
}
