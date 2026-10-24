import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { ListResolutionsQueryDto } from '../../../../store/invoicing/resolutions/dto/list-resolutions-query.dto';

/** Query del listado de resoluciones de organización. */
export class ListOrgInvoiceResolutionsQueryDto extends ListResolutionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}
