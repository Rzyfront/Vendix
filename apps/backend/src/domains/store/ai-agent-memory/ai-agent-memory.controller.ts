import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '../../../common/responses/response.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { VexEnabledGuard } from '../vex/guards/vex-enabled.guard';
import { AgentMemoryService } from '../../../ai-engine/memory/agent-memory.service';
import {
  CreateAgentMemoryDto,
  UpdateAgentMemoryDto,
} from './dto/ai-agent-memory.dto';

/**
 * F4 T31 — store memory of Vex (Ajustes → Agentes IA). Owner and admin only
 * and only while the store has Vex switched on: the same guards as
 * `VexController`, so a store without Vex cannot write memory nobody reads.
 * Every operation is bound to the session's store by `AgentMemoryService`.
 *
 *   GET    /store/ai-agents/memory        { items, limits }
 *   POST   /store/ai-agents/memory        { content, key?, kind? }  → origin manual
 *   PATCH  /store/ai-agents/memory/:id    { content }               → origin manual
 *   DELETE /store/ai-agents/memory/:id    { deleted: 1 }
 *   DELETE /store/ai-agents/memory        { deleted: n }
 */
@Controller('store/ai-agents/memory')
@UseGuards(RolesGuard, VexEnabledGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class AiAgentMemoryController {
  constructor(
    private readonly memory: AgentMemoryService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  async list() {
    return this.response.success(await this.memory.list(this.memory.actorFromRequest()));
  }

  @Post()
  async create(@Body() dto: CreateAgentMemoryDto) {
    const { item } = await this.memory.remember(this.memory.actorFromRequest(), {
      key: dto.key?.trim() || `manual.${Date.now().toString(36)}`,
      content: dto.content,
      kind: dto.kind,
      origin: 'manual',
    });
    return this.response.created(item);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAgentMemoryDto,
  ) {
    return this.response.success(
      await this.memory.edit(this.memory.actorFromRequest(), id, dto.content),
    );
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.memory.remove(this.memory.actorFromRequest(), id),
    );
  }

  @Delete()
  async removeAll() {
    return this.response.success(
      await this.memory.removeAll(this.memory.actorFromRequest()),
    );
  }
}
