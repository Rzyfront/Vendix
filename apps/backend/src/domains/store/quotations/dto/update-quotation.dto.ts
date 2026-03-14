import { PartialType } from '@nestjs/mapped-types';
import { CreateQuotationDto } from './create-quotation.dto';

export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {}
