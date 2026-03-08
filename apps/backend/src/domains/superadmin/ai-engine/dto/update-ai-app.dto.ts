import { PartialType } from '@nestjs/mapped-types';
import { CreateAIAppDto } from './create-ai-app.dto';

export class UpdateAIAppDto extends PartialType(CreateAIAppDto) {}
