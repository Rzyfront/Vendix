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
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  AdminOrganizationQueryDto,
  OrganizationDashboardDto,
} from './dto';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ResponseService } from '@common/responses/response.service';

@ApiTags('Admin Organizations')
@Controller('superadmin/organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class OrganizationsController {
  constructor(
    private readonly adminOrganizationsService: OrganizationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({
    status: 201,
    description: 'Organization created successfully',
  })
  async create(@Body() createOrganizationDto: CreateOrganizationDto) {
    const result = await this.adminOrganizationsService.create(
      createOrganizationDto,
    );
    return this.responseService.created(
      result,
      'Organization created successfully',
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Get all organizations with pagination and filtering',
  })
  @ApiResponse({
    status: 200,
    description: 'Organizations retrieved successfully',
  })
  async findAll(@Query() query: AdminOrganizationQueryDto) {
    const result = await this.adminOrganizationsService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Organizations retrieved successfully',
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics for organizations' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  async getDashboardStats() {
    const stats = await this.adminOrganizationsService.getDashboardStats();
    return this.responseService.success(
      stats,
      'Dashboard statistics retrieved successfully',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an organization by ID' })
  @ApiResponse({
    status: 200,
    description: 'Organization retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const organization = await this.adminOrganizationsService.findOne(id);
    return this.responseService.success(
      organization,
      'Organization retrieved successfully',
    );
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get an organization by slug' })
  @ApiResponse({
    status: 200,
    description: 'Organization retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async findBySlug(@Param('slug') slug: string) {
    const organization = await this.adminOrganizationsService.findBySlug(slug);
    return this.responseService.success(
      organization,
      'Organization retrieved successfully',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an organization' })
  @ApiResponse({
    status: 200,
    description: 'Organization updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    const organization = await this.adminOrganizationsService.update(
      id,
      updateOrganizationDto,
    );
    return this.responseService.updated(
      organization,
      'Organization updated successfully',
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an organization' })
  @ApiResponse({
    status: 200,
    description: 'Organization deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete organization with existing data',
  })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.adminOrganizationsService.remove(id);
    return this.responseService.deleted('Organization deleted successfully');
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get organization statistics' })
  @ApiResponse({
    status: 200,
    description: 'Organization statistics retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async getOrganizationStats(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: OrganizationDashboardDto,
  ) {
    const stats = await this.adminOrganizationsService.getDashboard(id, query);
    return this.responseService.success(
      stats,
      'Organization statistics retrieved successfully',
    );
  }
}
