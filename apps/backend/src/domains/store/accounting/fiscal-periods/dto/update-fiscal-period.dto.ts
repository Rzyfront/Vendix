import { PartialType } from '@nestjs/mapped-types';
import { CreateFiscalPeriodDto } from './create-fiscal-period.dto';

export class UpdateFiscalPeriodDto extends PartialType(CreateFiscalPeriodDto) {}
