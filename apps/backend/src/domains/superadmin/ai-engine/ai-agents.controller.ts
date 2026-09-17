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
import { AIAgentsService } from './ai-agents.service';
import { ResponseService } from '../../../common/responses/response.service';
import { CreateAIAgentDto, UpdateAIAgentDto, AIAgentQueryDto } from './dto';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';

@ApiTags('Admin AI Agents')
@Controller('superadmin/ai-engine/agents')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AIAgentsController {
  constructor(
    private readonly agentsService: AIAgentsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new AI agent' })
  @ApiResponse({ status: 201, description: 'Agent created' })
  async create(@Body() dto: CreateAIAgentDto) {
    const result = await this.agentsService.create(dto);
    return this.responseService.created(result, 'AI agent created successfully');
  }

  @Get()
  @ApiOperation({ summary: 'List all AI agents' })
  @ApiResponse({ status: 200, description: 'Agents retrieved' })
  async findAll(@Query() query: AIAgentQueryDto) {
    const result = await this.agentsService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'AI agents retrieved successfully',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an AI agent by ID' })
  @ApiResponse({ status: 200, description: 'Agent retrieved' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const agent = await this.agentsService.findOne(id);
    return this.responseService.success(agent, 'AI agent retrieved');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an AI agent' })
  @ApiResponse({ status: 200, description: 'Agent updated' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAIAgentDto,
  ) {
    const agent = await this.agentsService.update(id, dto);
    return this.responseService.updated(
      agent,
      'AI agent updated successfully',
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an AI agent' })
  @ApiResponse({ status: 200, description: 'Agent deleted' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.agentsService.remove(id);
    return this.responseService.deleted('AI agent deleted successfully');
  }
}
