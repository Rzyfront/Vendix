import { PartialType } from '@nestjs/mapped-types';
import { CreatePartnerPlanOverrideDto } from './create-partner-plan-override.dto';

export class UpdatePartnerPlanOverrideDto extends PartialType(
  CreatePartnerPlanOverrideDto,
) {}
