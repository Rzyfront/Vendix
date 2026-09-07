import { PartialType } from '@nestjs/mapped-types';
import { CreateQuotationDto } from './create-quotation.dto';

// A.1 (ADR-01): `destination` se hereda como opcional para que el
// ValidationPipe lo acepte y el servicio lo rechace con
// QUOTE_DESTINATION_001 (422). No excluirlo del DTO: con
// `forbidNonWhitelisted` un campo no declarado daria 400 sin codigo.
export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {}
