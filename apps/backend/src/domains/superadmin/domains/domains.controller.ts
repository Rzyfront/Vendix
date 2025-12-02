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
  HttpStatus,
} from '@nestjs/common';
import { DomainsService } from './domains.service';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
} from '../../organization/domains/dto/domain-settings.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ResponseService } from 'src/common/responses';

@ApiTags('Admin Domains')
@Controller('superadmin/domains')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminDomainsController {
  constructor(
    private readonly domainsService: DomainsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new domain' })
  @ApiResponse({ status: 201, description: 'Domain created successfully' })
  async create(@Body() createDomainSettingDto: CreateDomainSettingDto) {
    const domain = await this.domainsService.create(createDomainSettingDto);
    return this.responseService.created(domain, 'Domain created successfully');
  }

  @Get()
  @ApiOperation({ summary: 'Get all domains with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'Domains retrieved successfully' })
  async findAll(@Query() query: any) {
    const result = await this.domainsService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Domains retrieved successfully',
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics for domains' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  async getDashboardStats() {
    const stats = await this.domainsService.getDashboardStats();
    return this.responseService.success(
      stats,
      'Dashboard statistics retrieved successfully',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a domain by ID' })
  @ApiResponse({ status: 200, description: 'Domain retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  async findOne(@Param('id') id: string) {
    const domain = await this.domainsService.findOne(+id);
    return this.responseService.success(
      domain,
      'Domain retrieved successfully',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a domain' })
  @ApiResponse({ status: 200, description: 'Domain updated successfully' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDomainSettingDto: UpdateDomainSettingDto,
  ) {
    const domain = await this.domainsService.update(
      +id,
      updateDomainSettingDto,
    );
    return this.responseService.updated(domain, 'Domain updated successfully');
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a domain' })
  @ApiResponse({ status: 200, description: 'Domain deleted successfully' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete primary domain' })
  async remove(@Param('id') id: string) {
    await this.domainsService.remove(+id);
    return this.responseService.deleted('Domain deleted successfully');
  }

  @Post(':id/verify')
  @ApiOperation({ summary: 'Verify domain configuration' })
  @ApiResponse({ status: 200, description: 'Domain verification completed' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  async verifyDomain(@Param('id') id: string) {
    const result = await this.domainsService.verifyDomain(+id);
    return this.responseService.success(
      result,
      'Domain verification completed',
    );
  }
}
