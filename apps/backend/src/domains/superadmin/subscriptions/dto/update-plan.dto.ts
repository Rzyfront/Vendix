import { PartialType } from '@nestjs/mapped-types';
import { CreatePlanDto } from './plan.dto';

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
