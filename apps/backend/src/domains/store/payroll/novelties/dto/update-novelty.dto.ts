import { PartialType } from '@nestjs/mapped-types';
import { CreateNoveltyDto } from './create-novelty.dto';

export class UpdateNoveltyDto extends PartialType(CreateNoveltyDto) {}
