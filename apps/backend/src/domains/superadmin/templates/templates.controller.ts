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
import { TemplatesService } from './templates.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateQueryDto,
} from './dto';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ResponseService } from 'src/common/responses/response.service';

@ApiTags('Admin Templates')
@Controller('superadmin/templates')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class TemplatesController {
  constructor(
    private readonly templatesService: TemplatesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new template' })
  @ApiResponse({
    status: 201,
    description: 'Template created successfully',
  })
  async create(@Body() createTemplateDto: CreateTemplateDto) {
    const result = await this.templatesService.create(createTemplateDto);
    return this.responseService.created(result, 'Template created successfully');
  }

  @Get()
  @ApiOperation({
    summary: 'Get all templates with pagination and filtering',
  })
  @ApiResponse({
    status: 200,
    description: 'Templates retrieved successfully',
  })
  async findAll(@Query() query: TemplateQueryDto) {
    const result = await this.templatesService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Templates retrieved successfully',
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics for templates' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  async getDashboardStats() {
    const stats = await this.templatesService.getDashboardStats();
    return this.responseService.success(
      stats,
      'Dashboard statistics retrieved successfully',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a template by ID' })
  @ApiResponse({
    status: 200,
    description: 'Template retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const template = await this.templatesService.findOne(id);
    return this.responseService.success(
      template,
      'Template retrieved successfully',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a template' })
  @ApiResponse({
    status: 200,
    description: 'Template updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTemplateDto: UpdateTemplateDto,
  ) {
    const template = await this.templatesService.update(id, updateTemplateDto);
    return this.responseService.updated(
      template,
      'Template updated successfully',
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a template' })
  @ApiResponse({
    status: 200,
    description: 'Template deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Template not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete system templates',
  })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.templatesService.remove(id);
    return this.responseService.deleted('Template deleted successfully');
  }
}
