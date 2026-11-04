import { IsAppPage } from '../shared/app-page.dto';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_STORE_HOME_FOOTER } from './store-home.reader';

/** PATCH /store/apps/store-home/config */
export class UpdateStoreHomeConfigDto {
  /** Footer line about Vendix; empty = Vendix's default tagline. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STORE_HOME_FOOTER)
  footer_text?: string | null;
}

/**
 * PATCH /store/apps/store-home/page — Apps F2: the store home's own page (hero,
 * sections of its own catalog, brand and SEO). The blocks this app accepts
 * are listed in `shared/app-page.contract.ts` (`APP_PAGE_BLOCKS.store_home`).
 */
export class UpdateStoreHomePageDto {
  @IsAppPage('store_home')
  page!: Record<string, unknown>;
}
