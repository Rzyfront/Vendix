import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AIEngineConfigService } from './ai-engine.service';
import { AILoggingService } from '../../../ai-engine/ai-logging.service';
import { ResponseService } from '../../../common/responses/response.service';
import { CreateAIConfigDto, UpdateAIConfigDto, AIConfigQueryDto } from './dto';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';

@ApiTags('Admin AI Engine')
@Controller('superadmin/ai-engine')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AIEngineController {
  constructor(
    private readonly aiEngineConfigService: AIEngineConfigService,
    private readonly aiLoggingService: AILoggingService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new AI engine configuration' })
  @ApiResponse({ status: 201, description: 'Configuration created' })
  async create(@Body() dto: CreateAIConfigDto) {
    const result = await this.aiEngineConfigService.create(dto);
    return this.responseService.created(
      result,
      'AI configuration created successfully',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List all AI engine configurations' })
  @ApiResponse({ status: 200, description: 'Configurations retrieved' })
  async findAll(@Query() query: AIConfigQueryDto) {
    const result = await this.aiEngineConfigService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'AI configurations retrieved successfully',
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get AI engine dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard stats retrieved' })
  async getDashboardStats() {
    const stats = await this.aiEngineConfigService.getDashboardStats();
    return this.responseService.success(
      stats,
      'Dashboard statistics retrieved successfully',
    );
  }

  @Get('usage-stats')
  @ApiOperation({ summary: 'Get AI usage statistics' })
  @ApiResponse({ status: 200, description: 'Usage statistics retrieved' })
  async getUsageStats(
    @Query('app_key') appKey?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('organization_id') orgId?: string,
    @Query('store_id') storeId?: string,
  ) {
    const filter: any = {};
    if (appKey) filter.app_key = appKey;
    if (orgId) filter.organization_id = Number(orgId);
    if (storeId) filter.store_id = Number(storeId);
    if (dateFrom) filter.date_from = new Date(dateFrom);
    if (dateTo) filter.date_to = new Date(dateTo);

    const stats = await this.aiLoggingService.getUsageStats(filter);
    return this.responseService.success(stats, 'AI usage statistics retrieved');
  }

  @Get('usage-stats/:orgId')
  @ApiOperation({ summary: 'Get AI usage statistics for a specific tenant' })
  @ApiResponse({
    status: 200,
    description: 'Tenant usage statistics retrieved',
  })
  async getUsageByTenant(
    @Param('orgId') orgId: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    const stats = await this.aiLoggingService.getUsageByTenant(
      Number(orgId),
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
    );
    return this.responseService.success(
      stats,
      'Tenant AI usage statistics retrieved',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an AI engine configuration by ID' })
  @ApiResponse({ status: 200, description: 'Configuration retrieved' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const config = await this.aiEngineConfigService.findOne(id);
    return this.responseService.success(
      config,
      'AI configuration retrieved successfully',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an AI engine configuration' })
  @ApiResponse({ status: 200, description: 'Configuration updated' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAIConfigDto,
  ) {
    const config = await this.aiEngineConfigService.update(id, dto);
    return this.responseService.updated(
      config,
      'AI configuration updated successfully',
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an AI engine configuration' })
  @ApiResponse({ status: 200, description: 'Configuration deleted' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.aiEngineConfigService.remove(id);
    return this.responseService.deleted(
      'AI configuration deleted successfully',
    );
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Test connection to an AI provider' })
  @ApiResponse({ status: 200, description: 'Test result returned' })
  async testConnection(@Param('id', ParseIntPipe) id: number) {
    const result = await this.aiEngineConfigService.testConnection(id);
    return this.responseService.success(result, 'Connection test completed');
  }
}
