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
