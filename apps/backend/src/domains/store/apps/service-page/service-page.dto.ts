import { IsAppPage } from '../shared/app-page.dto';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, Min } from 'class-validator';
import {
  MAX_FEATURED_SERVICES,
  MAX_SECONDARY_PRODUCTS,
} from './service-page.reader';

/** PATCH /store/apps/service_page/config */
export class UpdateServicePageConfigDto {
  /** Services shown first, in this order. Empty = the page lists by name. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FEATURED_SERVICES)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  featured_service_ids?: number[];

  /** Products of the secondary "también puedes comprar" block. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SECONDARY_PRODUCTS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  product_ids?: number[];
}

/** POST /store/apps/service_page/publish */
export class PublishServicePageDto {
  /** One of the store's custom domains; omitted = `{store}-service` subdomain. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  custom_domain_id?: number;
}

/**
 * PATCH /store/apps/service_page/page — Apps F2: the service page's own page (hero,
 * sections of its own catalog, brand and SEO). The blocks this app accepts
 * are listed in `shared/app-page.contract.ts` (`APP_PAGE_BLOCKS.service_page`).
 */
export class UpdateServicePagePageDto {
  @IsAppPage('service_page')
  page!: Record<string, unknown>;
}
