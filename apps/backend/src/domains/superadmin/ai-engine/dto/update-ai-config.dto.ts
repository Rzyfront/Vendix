import { PartialType } from '@nestjs/mapped-types';
import { CreateAIConfigDto } from './create-ai-config.dto';

export class UpdateAIConfigDto extends PartialType(CreateAIConfigDto) {}
