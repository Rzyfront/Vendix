import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { CreateResolutionDto } from '../../../../store/invoicing/resolutions/dto/create-resolution.dto';

export class CreateOrgInvoiceResolutionDto extends CreateResolutionDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;
}
