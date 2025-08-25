import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsObject,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsIn,
  IsUrl,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BrandingConfigDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  storeName?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsUrl()
  favicon?: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  accentColor?: string;
}

export class SeoConfigDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsUrl()
  ogImage?: string;

  @IsOptional()
  @IsString()
  ogType?: string;

  @IsOptional()
  @IsString()
  robots?: string;

  @IsOptional()
  @IsUrl()
  canonicalUrl?: string;
}

export class FeaturesConfigDto {
  // Características organizacionales
  @IsOptional()
  @IsBoolean()
  multiStore?: boolean;

  @IsOptional()
  @IsBoolean()
  userManagement?: boolean;

  @IsOptional()
  @IsBoolean()
  analytics?: boolean;

  @IsOptional()
  @IsBoolean()
  customDomain?: boolean;

  // Características de tienda
  @IsOptional()
  @IsBoolean()
  inventory?: boolean;

  @IsOptional()
  @IsBoolean()
  pos?: boolean;

  @IsOptional()
  @IsBoolean()
  orders?: boolean;

  @IsOptional()
  @IsBoolean()
  customers?: boolean;

  @IsOptional()
  @IsBoolean()
  guestCheckout?: boolean;

  @IsOptional()
  @IsBoolean()
  wishlist?: boolean;

  @IsOptional()
  @IsBoolean()
  reviews?: boolean;

  @IsOptional()
  @IsBoolean()
  coupons?: boolean;

  @IsOptional()
  @IsBoolean()
  shipping?: boolean;

  @IsOptional()
  @IsBoolean()
  payments?: boolean;

  // Características avanzadas
  @IsOptional()
  @IsBoolean()
  apiAccess?: boolean;

  @IsOptional()
  @IsBoolean()
  webhooks?: boolean;

  @IsOptional()
  @IsBoolean()
  customThemes?: boolean;

  @IsOptional()
  @IsBoolean()
  advancedAnalytics?: boolean;
}

export class ThemeConfigDto {
  @IsOptional()
  @IsIn(['sidebar', 'topbar', 'minimal'])
  layout?: 'sidebar' | 'topbar' | 'minimal';

  @IsOptional()
  @IsIn(['expanded', 'collapsed', 'overlay'])
  sidebarMode?: 'expanded' | 'collapsed' | 'overlay';

  @IsOptional()
  @IsIn(['light', 'dark', 'auto'])
  colorScheme?: 'light' | 'dark' | 'auto';

  @IsOptional()
  @IsString()
  borderRadius?: string;

  @IsOptional()
  @IsString()
  fontFamily?: string;

  @IsOptional()
  @IsString()
  customCss?: string;
}

export class EcommerceConfigDto {
  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsIn(['manual', 'automatic', 'disabled'])
  taxCalculation?: 'manual' | 'automatic' | 'disabled';

  @IsOptional()
  @IsBoolean()
  shippingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  digitalProductsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  subscriptionsEnabled?: boolean;
}

export class IntegrationsConfigDto {
  @IsOptional()
  @IsString()
  googleAnalytics?: string;

  @IsOptional()
  @IsString()
  googleTagManager?: string;

  @IsOptional()
  @IsString()
  facebookPixel?: string;

  @IsOptional()
  @IsString()
  hotjar?: string;

  @IsOptional()
  @IsString()
  intercom?: string;

  @IsOptional()
  @IsString()
  crisp?: string;
}

export class SecurityConfigDto {
  @IsOptional()
  @IsBoolean()
  forceHttps?: boolean;

  @IsOptional()
  @IsBoolean()
  hsts?: boolean;

  @IsOptional()
  @IsString()
  contentSecurityPolicy?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];
}

export class PerformanceConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(86400)
  cacheTtl?: number;

  @IsOptional()
  @IsBoolean()
  cdnEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  compressionEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  imageLazyLoading?: boolean;
}

export class CreateDomainConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingConfigDto)
  branding?: BrandingConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SeoConfigDto)
  seo?: SeoConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FeaturesConfigDto)
  features?: FeaturesConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ThemeConfigDto)
  theme?: ThemeConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceConfigDto)
  ecommerce?: EcommerceConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationsConfigDto)
  integrations?: IntegrationsConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SecurityConfigDto)
  security?: SecurityConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerformanceConfigDto)
  performance?: PerformanceConfigDto;
}

export class CreateDomainSettingDto {
  @IsString()
  @IsNotEmpty()
  hostname: string;

  @IsNumber()
  @IsNotEmpty()
  organizationId: number;

  @IsOptional()
  @IsNumber()
  storeId?: number;

  @IsObject()
  @ValidateNested()
  @Type(() => CreateDomainConfigDto)
  config: CreateDomainConfigDto;
}

export class UpdateDomainSettingDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateDomainConfigDto)
  config?: CreateDomainConfigDto;
}

export class ValidateHostnameDto {
  @IsString()
  @IsNotEmpty()
  hostname: string;
}

export class DuplicateDomainDto {
  @IsString()
  @IsNotEmpty()
  newHostname: string;
}
