import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MEMORY_KINDS, MemoryKind } from '../../../../ai-engine/memory/agent-memory.service';

/** Length caps are enforced by the service so the client gets `AI_MEMORY_LIMIT_001`. */
export class CreateAgentMemoryDto {
  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  key?: string;

  @IsOptional()
  @IsIn([...MEMORY_KINDS])
  kind?: MemoryKind;
}

export class UpdateAgentMemoryDto {
  @IsString()
  @IsNotEmpty()
  content!: string;
}
