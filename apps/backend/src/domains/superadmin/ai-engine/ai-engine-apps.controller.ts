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
import { AIEngineAppsService } from './ai-engine-apps.service';
import { ResponseService } from '../../../common/responses/response.service';
import { CreateAIAppDto, UpdateAIAppDto, AIAppQueryDto } from './dto';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';

@ApiTags('Admin AI Applications')
@Controller('superadmin/ai-engine/applications')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AIEngineAppsController {
  constructor(
    private readonly appsService: AIEngineAppsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new AI application' })
  @ApiResponse({ status: 201, description: 'Application created' })
  async create(@Body() dto: CreateAIAppDto) {
    const result = await this.appsService.create(dto);
    return this.responseService.created(result, 'AI application created successfully');
  }

  @Get()
  @ApiOperation({ summary: 'List all AI applications' })
  @ApiResponse({ status: 200, description: 'Applications retrieved' })
  async findAll(@Query() query: AIAppQueryDto) {
    const result = await this.appsService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'AI applications retrieved successfully',
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get AI applications dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard stats retrieved' })
  async getDashboardStats() {
    const stats = await this.appsService.getDashboardStats();
    return this.responseService.success(stats, 'Dashboard statistics retrieved');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an AI application by ID' })
  @ApiResponse({ status: 200, description: 'Application retrieved' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const app = await this.appsService.findOne(id);
    return this.responseService.success(app, 'AI application retrieved');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an AI application' })
  @ApiResponse({ status: 200, description: 'Application updated' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAIAppDto,
  ) {
    const app = await this.appsService.update(id, dto);
    return this.responseService.updated(app, 'AI application updated successfully');
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an AI application' })
  @ApiResponse({ status: 200, description: 'Application deleted' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.appsService.remove(id);
    return this.responseService.deleted('AI application deleted successfully');
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Test an AI application with sample data' })
  @ApiResponse({ status: 200, description: 'Test result returned' })
  async testApplication(@Param('id', ParseIntPipe) id: number) {
    const result = await this.appsService.testApplication(id);
    return this.responseService.success(result, 'Application test completed');
  }
}
