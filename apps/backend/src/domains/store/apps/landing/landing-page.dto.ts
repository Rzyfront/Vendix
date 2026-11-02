import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CrmContactDto } from '../../crm/dto/crm-contact.dto';
import { MAX_OFFER_DESCRIPTION, MAX_OFFER_TITLE } from './landing-page.reader';

/** PATCH /store/apps/landing/config */
export class UpdateLandingPageConfigDto {
  /** `info` only captures the lead; `product` adds one product to buy. */
  @IsIn(['info', 'product'])
  offer_mode!: 'info' | 'product';

  /** Empty = the product name, or a default capture headline. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_OFFER_TITLE)
  offer_title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_OFFER_DESCRIPTION)
  offer_description?: string | null;

  /** Required when `offer_mode = 'product'`; ignored otherwise. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  offer_product_id?: number | null;
}

/** POST /store/apps/landing/publish */
export class PublishLandingPageDto {
  /** One of the store's custom domains; omitted = `{store}-landing` subdomain. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  custom_domain_id?: number;
}

/**
 * POST /ecommerce/landing-page/lead — the same form fields as
 * `POST /ecommerce/crm/contact`, so the landing form posts the same body.
 */
export class LandingLeadDto extends CrmContactDto {}
