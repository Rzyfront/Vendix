import { PartialType } from '@nestjs/mapped-types';
import { CreateAIAgentDto } from './create-ai-agent.dto';

export class UpdateAIAgentDto extends PartialType(CreateAIAgentDto) {}
