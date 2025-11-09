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
  company_name?: string;

  @ApiPropertyOptional({
    example: 'Mi Tienda',
    description: 'Nombre de la tienda (opcional)',
  })
  @IsOptional()
  @IsString()
  store_name?: string;

  @ApiPropertyOptional({
    example: 'https://ejemplo.com/logo.png',
    description: 'URL del logo (opcional)',
  })
  @IsOptional()
  @IsUrl()
  logo_url?: string;

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
  primary_color?: string;

  @ApiPropertyOptional({
    example: '#ffffff',
    description: 'Color secundario (opcional)',
  })
  @IsOptional()
  @IsString()
  secondary_color?: string;

  @ApiPropertyOptional({
    example: '#ff0000',
    description: 'Color de acento (opcional)',
  })
  @IsOptional()
  @IsString()
  accent_color?: string;
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
  og_image?: string;

  @ApiPropertyOptional({
    example: 'website',
    description: 'Tipo OpenGraph (opcional)',
  })
  @IsOptional()
  @IsString()
  og_type?: string;

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
  canonical_url?: string;
}

export class FeaturesConfigDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  multi_store?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  user_management?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  analytics?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  custom_domain?: boolean;

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
  guest_checkout?: boolean;

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
  api_access?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  webhooks?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  custom_themes?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  advanced_analytics?: boolean;
}

export class ThemeConfigDto {
  @ApiPropertyOptional({ example: 'sidebar' })
  @IsOptional()
  @IsIn(['sidebar', 'topbar', 'minimal'])
  layout?: 'sidebar' | 'topbar' | 'minimal';

  @ApiPropertyOptional({ example: 'expanded' })
  @IsOptional()
  @IsIn(['expanded', 'collapsed', 'overlay'])
  sidebar_mode?: 'expanded' | 'collapsed' | 'overlay';

  @ApiPropertyOptional({ example: 'light' })
  @IsOptional()
  @IsIn(['light', 'dark', 'auto'])
  color_scheme?: 'light' | 'dark' | 'auto';

  @ApiPropertyOptional({ example: '8px' })
  @IsOptional()
  @IsString()
  border_radius?: string;

  @ApiPropertyOptional({ example: 'Inter, sans-serif' })
  @IsOptional()
  @IsString()
  font_family?: string;

  @ApiPropertyOptional({ example: '.custom { color: red; }' })
  @IsOptional()
  @IsString()
  custom_css?: string;
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
  tax_calculation?: 'manual' | 'automatic' | 'disabled';

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  shipping_enabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  digital_products_enabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  subscriptions_enabled?: boolean;
}

export class IntegrationsConfigDto {
  @ApiPropertyOptional({ example: 'UA-123456' })
  @IsOptional()
  @IsString()
  google_analytics?: string;

  @ApiPropertyOptional({ example: 'GTM-ABC123' })
  @IsOptional()
  @IsString()
  google_tag_manager?: string;

  @ApiPropertyOptional({ example: 'FB-PIXEL-123' })
  @IsOptional()
  @IsString()
  facebook_pixel?: string;

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
  force_https?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hsts?: boolean;

  @ApiPropertyOptional({ example: 'default-src https:' })
  @IsOptional()
  @IsString()
  content_security_policy?: string;

  @ApiPropertyOptional({ example: ['https://ejemplo.com'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_origins?: string[];
}

export class PerformanceConfigDto {
  @ApiPropertyOptional({ example: 3600 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(86400)
  cache_ttl?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  cdn_enabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  compression_enabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  image_lazy_loading?: boolean;
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

  @ApiPropertyOptional({ example: 'ecommerce' })
  @IsOptional()
  @IsIn(['vendix_core', 'organization', 'store', 'ecommerce'])
  domain_type?: string;

  @ApiPropertyOptional({ example: 'pending_dns' })
  @IsOptional()
  @IsIn(['pending_dns', 'pending_ssl', 'active', 'disabled'])
  status?: string;

  @ApiPropertyOptional({ example: 'none' })
  @IsOptional()
  @IsIn(['none', 'pending', 'issued', 'error', 'revoked'])
  ssl_status?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @ApiPropertyOptional({ example: 'vendix_subdomain' })
  @IsOptional()
  @IsIn([
    'vendix_subdomain',
    'custom_domain',
    'custom_subdomain',
    'vendix_core',
    'third_party_subdomain',
  ])
  ownership?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsNotEmpty()
  organization_id: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  store_id?: number;

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
  @IsIn(['vendix_core', 'organization', 'store', 'ecommerce'])
  domain_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['pending_dns', 'pending_ssl', 'active', 'disabled'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['none', 'pending', 'issued', 'error', 'revoked'])
  ssl_status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn([
    'vendix_subdomain',
    'custom_domain',
    'custom_subdomain',
    'vendix_core',
    'third_party_subdomain',
  ])
  ownership?: string;
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
  new_hostname: string;
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
  status_before: string;
  status_after: string;
  ssl_status: string;
  verified: boolean;
  next_action?: string;
  checks: Record<string, any>;
  suggested_fixes?: string[];
  timestamp: string;
  error_code?: string;
}
