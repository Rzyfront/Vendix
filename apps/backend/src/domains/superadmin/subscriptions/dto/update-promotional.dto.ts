import { PartialType } from '@nestjs/mapped-types';
import { CreatePromotionalDto } from './promotional.dto';

export class UpdatePromotionalDto extends PartialType(CreatePromotionalDto) {}
