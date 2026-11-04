import { IsAppPage } from '../shared/app-page.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';
import { MAX_COMPLEMENTS } from './product-page.reader';

/** PATCH /store/apps/product_page/config */
export class UpdateProductPageConfigDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COMPLEMENTS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  complement_product_ids?: number[];
}

/** POST /store/apps/product_page/publish */
export class PublishProductPageDto {
  /** One of the store's custom domains; omitted = `{store}-{product}` subdomain. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  custom_domain_id?: number;
}

/**
 * PATCH /store/apps/product_page/page — Apps F2: the product page's own page (hero,
 * sections of its own catalog, brand and SEO). The blocks this app accepts
 * are listed in `shared/app-page.contract.ts` (`APP_PAGE_BLOCKS.product_page`).
 */
export class UpdateProductPagePageDto {
  @IsAppPage('product_page')
  page!: Record<string, unknown>;
}
