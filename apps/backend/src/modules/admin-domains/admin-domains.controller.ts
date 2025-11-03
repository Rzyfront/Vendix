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
import { AdminDomainsService } from './admin-domains.service';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
} from '../domains/dto/domain-settings.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Admin Domains')
@Controller('admin/domains')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminDomainsController {
  constructor(private readonly adminDomainsService: AdminDomainsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new domain' })
  @ApiResponse({ status: 201, description: 'Domain created successfully' })
  create(@Body() createDomainSettingDto: CreateDomainSettingDto) {
    return this.adminDomainsService.create(createDomainSettingDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all domains with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'Domains retrieved successfully' })
  findAll(@Query() query: any) {
    return this.adminDomainsService.findAll(query);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics for domains' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  getDashboardStats() {
    return this.adminDomainsService.getDashboardStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a domain by ID' })
  @ApiResponse({ status: 200, description: 'Domain retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  findOne(@Param('id') id: string) {
    return this.adminDomainsService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a domain' })
  @ApiResponse({ status: 200, description: 'Domain updated successfully' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  update(
    @Param('id') id: string,
    @Body() updateDomainSettingDto: UpdateDomainSettingDto,
  ) {
    return this.adminDomainsService.update(+id, updateDomainSettingDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a domain' })
  @ApiResponse({ status: 200, description: 'Domain deleted successfully' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete primary domain' })
  remove(@Param('id') id: string) {
    return this.adminDomainsService.remove(+id);
  }

  @Post(':id/verify')
  @ApiOperation({ summary: 'Verify domain configuration' })
  @ApiResponse({ status: 200, description: 'Domain verification completed' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  verifyDomain(@Param('id') id: string) {
    return this.adminDomainsService.verifyDomain(+id);
  }
}
