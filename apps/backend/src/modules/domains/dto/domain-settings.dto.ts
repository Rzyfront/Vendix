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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BrandingConfigDto {
  @ApiPropertyOptional({
    example: 'Mi Empresa',
    description: 'Nombre de la empresa (opcional)',
  })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({
    example: 'Mi Tienda',
    description: 'Nombre de la tienda (opcional)',
  })
  @IsOptional()
  @IsString()
  storeName?: string;

  @ApiPropertyOptional({
    example: 'https://ejemplo.com/logo.png',
    description: 'URL del logo (opcional)',
  })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({
    example: 'https://ejemplo.com/favicon.ico',
    description: 'URL del favicon (opcional)',
  })
  @IsOptional()
  @IsUrl()
  favicon?: string;

  @ApiPropertyOptional({
    example: '#007bff',
    description: 'Color primario (opcional)',
  })
  @IsOptional()
  @IsString()
  primaryColor?: string;

  @ApiPropertyOptional({
    example: '#ffffff',
    description: 'Color secundario (opcional)',
  })
  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @ApiPropertyOptional({
    example: '#ff0000',
    description: 'Color de acento (opcional)',
  })
  @IsOptional()
  @IsString()
  accentColor?: string;
}

export class SeoConfigDto {
  @ApiPropertyOptional({
    example: 'Página principal',
    description: 'Título SEO (opcional)',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    example: 'Descripción para SEO',
    description: 'Descripción SEO (opcional)',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: ['ecommerce', 'tienda'],
    description: 'Palabras clave SEO (opcional)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({
    example: 'https://ejemplo.com/og.png',
    description: 'Imagen OpenGraph (opcional)',
  })
  @IsOptional()
  @IsUrl()
  ogImage?: string;

  @ApiPropertyOptional({
    example: 'website',
    description: 'Tipo OpenGraph (opcional)',
  })
  @IsOptional()
  @IsString()
  ogType?: string;

  @ApiPropertyOptional({
    example: 'index,follow',
    description: 'Robots meta tag (opcional)',
  })
  @IsOptional()
  @IsString()
  robots?: string;

  @ApiPropertyOptional({
    example: 'https://ejemplo.com',
    description: 'Canonical URL (opcional)',
  })
  @IsOptional()
  @IsUrl()
  canonicalUrl?: string;
}

export class FeaturesConfigDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  multiStore?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  userManagement?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  analytics?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  customDomain?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  inventory?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  pos?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  orders?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  customers?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  guestCheckout?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  wishlist?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  reviews?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  coupons?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  shipping?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  payments?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  apiAccess?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  webhooks?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  customThemes?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  advancedAnalytics?: boolean;
}

export class ThemeConfigDto {
  @ApiPropertyOptional({ example: 'sidebar' })
  @IsOptional()
  @IsIn(['sidebar', 'topbar', 'minimal'])
  layout?: 'sidebar' | 'topbar' | 'minimal';

  @ApiPropertyOptional({ example: 'expanded' })
  @IsOptional()
  @IsIn(['expanded', 'collapsed', 'overlay'])
  sidebarMode?: 'expanded' | 'collapsed' | 'overlay';

  @ApiPropertyOptional({ example: 'light' })
  @IsOptional()
  @IsIn(['light', 'dark', 'auto'])
  colorScheme?: 'light' | 'dark' | 'auto';

  @ApiPropertyOptional({ example: '8px' })
  @IsOptional()
  @IsString()
  borderRadius?: string;

  @ApiPropertyOptional({ example: 'Inter, sans-serif' })
  @IsOptional()
  @IsString()
  fontFamily?: string;

  @ApiPropertyOptional({ example: '.custom { color: red; }' })
  @IsOptional()
  @IsString()
  customCss?: string;
}

export class EcommerceConfigDto {
  @ApiPropertyOptional({ example: 'MXN' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'es-MX' })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional({ example: 'America/Mexico_City' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 'manual' })
  @IsOptional()
  @IsIn(['manual', 'automatic', 'disabled'])
  taxCalculation?: 'manual' | 'automatic' | 'disabled';

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  shippingEnabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  digitalProductsEnabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  subscriptionsEnabled?: boolean;
}

export class IntegrationsConfigDto {
  @ApiPropertyOptional({ example: 'UA-123456' })
  @IsOptional()
  @IsString()
  googleAnalytics?: string;

  @ApiPropertyOptional({ example: 'GTM-ABC123' })
  @IsOptional()
  @IsString()
  googleTagManager?: string;

  @ApiPropertyOptional({ example: 'FB-PIXEL-123' })
  @IsOptional()
  @IsString()
  facebookPixel?: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  hotjar?: string;

  @ApiPropertyOptional({ example: 'abc123' })
  @IsOptional()
  @IsString()
  intercom?: string;

  @ApiPropertyOptional({ example: 'crisp-123' })
  @IsOptional()
  @IsString()
  crisp?: string;
}

export class SecurityConfigDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  forceHttps?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hsts?: boolean;

  @ApiPropertyOptional({ example: 'default-src https:' })
  @IsOptional()
  @IsString()
  contentSecurityPolicy?: string;

  @ApiPropertyOptional({ example: ['https://ejemplo.com'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];
}

export class PerformanceConfigDto {
  @ApiPropertyOptional({ example: 3600 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(86400)
  cacheTtl?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  cdnEnabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  compressionEnabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  imageLazyLoading?: boolean;
}

export class CreateDomainConfigDto {
  @ApiPropertyOptional({ type: () => BrandingConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingConfigDto)
  branding?: BrandingConfigDto;

  @ApiPropertyOptional({ type: () => SeoConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SeoConfigDto)
  seo?: SeoConfigDto;

  @ApiPropertyOptional({ type: () => FeaturesConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeaturesConfigDto)
  features?: FeaturesConfigDto;

  @ApiPropertyOptional({ type: () => ThemeConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ThemeConfigDto)
  theme?: ThemeConfigDto;

  @ApiPropertyOptional({ type: () => EcommerceConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceConfigDto)
  ecommerce?: EcommerceConfigDto;

  @ApiPropertyOptional({ type: () => IntegrationsConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationsConfigDto)
  integrations?: IntegrationsConfigDto;

  @ApiPropertyOptional({ type: () => SecurityConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SecurityConfigDto)
  security?: SecurityConfigDto;

  @ApiPropertyOptional({ type: () => PerformanceConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PerformanceConfigDto)
  performance?: PerformanceConfigDto;
}

export class CreateDomainSettingDto {
  @ApiProperty({ example: 'tienda.ejemplo.com' })
  @IsString()
  @IsNotEmpty()
  hostname: string;

  @ApiPropertyOptional({ example: 'store_subdomain' })
  @IsOptional()
  @IsIn(['vendix_core', 'organization_root', 'organization_subdomain', 'store_subdomain', 'store_custom'])
  domainType?: string;

  @ApiPropertyOptional({ example: 'pending_dns' })
  @IsOptional()
  @IsIn(['pending_dns', 'pending_ssl', 'active', 'disabled'])
  status?: string;

  @ApiPropertyOptional({ example: 'none' })
  @IsOptional()
  @IsIn(['none', 'pending', 'issued', 'error', 'revoked'])
  sslStatus?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsNotEmpty()
  organizationId: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  storeId?: number;

  @ApiProperty({ type: () => CreateDomainConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => CreateDomainConfigDto)
  config: CreateDomainConfigDto;
}

export class UpdateDomainSettingDto {
  @ApiPropertyOptional({ type: () => CreateDomainConfigDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateDomainConfigDto)
  config?: CreateDomainConfigDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['vendix_core', 'organization_root', 'organization_subdomain', 'store_subdomain', 'store_custom'])
  domainType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['pending_dns', 'pending_ssl', 'active', 'disabled'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['none', 'pending', 'issued', 'error', 'revoked'])
  sslStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class ValidateHostnameDto {
  @ApiProperty({ example: 'tienda.ejemplo.com' })
  @IsString()
  @IsNotEmpty()
  hostname: string;
}

export class DuplicateDomainDto {
  @ApiProperty({ example: 'nueva-tienda.ejemplo.com' })
  @IsString()
  @IsNotEmpty()
  newHostname: string;
}

export class VerifyDomainDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsIn(['txt', 'cname', 'a', 'aaaa'], { each: true })
  checks?: ('txt' | 'cname' | 'a' | 'aaaa')[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expectedCname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expectedA?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mode?: string;
}

export interface VerifyDomainResult {
  hostname: string;
  statusBefore: string;
  statusAfter: string;
  sslStatus: string;
  verified: boolean;
  nextAction?: string;
  checks: Record<string, any>;
  suggestedFixes?: string[];
  timestamp: string;
  errorCode?: string;
}
