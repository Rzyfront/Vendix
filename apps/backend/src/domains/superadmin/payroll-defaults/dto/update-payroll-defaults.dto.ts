import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreatePayrollDefaultsDto } from './create-payroll-defaults.dto';

export class UpdatePayrollDefaultsDto extends PartialType(
  OmitType(CreatePayrollDefaultsDto, ['year'] as const),
) {}
