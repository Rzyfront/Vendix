import { PartialType } from '@nestjs/mapped-types';
import { CreateWithholdingConceptDto } from './create-withholding-concept.dto';

export class UpdateWithholdingConceptDto extends PartialType(CreateWithholdingConceptDto) {}
