import { PartialType } from '@nestjs/mapped-types';
import { CreateOrgInvoiceResolutionDto } from './create-org-invoice-resolution.dto';

export class UpdateOrgInvoiceResolutionDto extends PartialType(
  CreateOrgInvoiceResolutionDto,
) {}
