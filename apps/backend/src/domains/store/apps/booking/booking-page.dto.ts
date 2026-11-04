import { IsAppPage } from '../shared/app-page.dto';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, Min } from 'class-validator';
import { MAX_BOOKING_PRODUCTS } from './booking-page.reader';

/** PATCH /store/apps/booking/config */
export class UpdateBookingPageConfigDto {
  /** Amenities and products of the secondary block, in this order. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BOOKING_PRODUCTS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  product_ids?: number[];
}

/** POST /store/apps/booking/publish */
export class PublishBookingPageDto {
  /** One of the store's custom domains; omitted = `{store}-booking` subdomain. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  custom_domain_id?: number;
}

/**
 * PATCH /store/apps/booking/page — Apps F2: the booking page's own page (hero,
 * sections of its own catalog, brand and SEO). The blocks this app accepts
 * are listed in `shared/app-page.contract.ts` (`APP_PAGE_BLOCKS.booking`).
 */
export class UpdateBookingPagePageDto {
  @IsAppPage('booking')
  page!: Record<string, unknown>;
}
