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
  @ApiPropertyOptional({ example: 'Mi Empresa', description: 'Nombre de la empresa (opcional)' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ example: 'Mi Tienda', description: 'Nombre de la tienda (opcional)' })
  @IsOptional()
  @IsString()
  storeName?: string;

  @ApiPropertyOptional({ example: 'https://ejemplo.com/logo.png', description: 'URL del logo (opcional)' })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'https://ejemplo.com/favicon.ico', description: 'URL del favicon (opcional)' })
  @IsOptional()
  @IsUrl()
  favicon?: string;

  @ApiPropertyOptional({ example: '#007bff', description: 'Color primario (opcional)' })
  @IsOptional()
  @IsString()
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#ffffff', description: 'Color secundario (opcional)' })
  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @ApiPropertyOptional({ example: '#ff0000', description: 'Color de acento (opcional)' })
  @IsOptional()
  @IsString()
  accentColor?: string;
}

export class SeoConfigDto {
  @ApiPropertyOptional({ example: 'Página principal', description: 'Título SEO (opcional)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Descripción para SEO', description: 'Descripción SEO (opcional)' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: ['ecommerce', 'tienda'], description: 'Palabras clave SEO (opcional)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({ example: 'https://ejemplo.com/og.png', description: 'Imagen OpenGraph (opcional)' })
  @IsOptional()
  @IsUrl()
  ogImage?: string;

  @ApiPropertyOptional({ example: 'website', description: 'Tipo OpenGraph (opcional)' })
  @IsOptional()
  @IsString()
  ogType?: string;

  @ApiPropertyOptional({ example: 'index,follow', description: 'Robots meta tag (opcional)' })
  @IsOptional()
  @IsString()
  robots?: string;

  @ApiPropertyOptional({ example: 'https://ejemplo.com', description: 'Canonical URL (opcional)' })
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
  @ApiPropertyOptional({ example: true, description: '¿Permite múltiples tiendas? (opcional)' })
  inventory?: boolean;

  @IsOptional()

  @ApiPropertyOptional({ example: true, description: '¿Permite gestión de usuarios? (opcional)' })
  @IsBoolean()
  pos?: boolean;


  @ApiPropertyOptional({ example: true, description: '¿Permite analíticas? (opcional)' })
  @IsOptional()
  @IsBoolean()
  orders?: boolean;

  @ApiPropertyOptional({ example: true, description: '¿Permite dominio personalizado? (opcional)' })

  @IsOptional()
  @IsBoolean()

  @ApiPropertyOptional({ example: true, description: '¿Permite inventario? (opcional)' })
  customers?: boolean;

  @IsOptional()

  @ApiPropertyOptional({ example: true, description: '¿Permite punto de venta? (opcional)' })
  @IsBoolean()
  guestCheckout?: boolean;


  @ApiPropertyOptional({ example: true, description: '¿Permite órdenes? (opcional)' })
  @IsOptional()
  @IsBoolean()
  wishlist?: boolean;

  @ApiPropertyOptional({ example: true, description: '¿Permite clientes? (opcional)' })

  @IsOptional()
  @IsBoolean()

  @ApiPropertyOptional({ example: true, description: '¿Permite checkout como invitado? (opcional)' })
  reviews?: boolean;

  @IsOptional()

  @ApiPropertyOptional({ example: true, description: '¿Permite wishlist? (opcional)' })
  @IsBoolean()
  coupons?: boolean;


  @ApiPropertyOptional({ example: true, description: '¿Permite reviews? (opcional)' })
  @IsOptional()
  @IsBoolean()
  shipping?: boolean;

  @ApiPropertyOptional({ example: true, description: '¿Permite cupones? (opcional)' })

  @IsOptional()
  @IsBoolean()

  @ApiPropertyOptional({ example: true, description: '¿Permite envíos? (opcional)' })
  payments?: boolean;

  // Características avanzadas

  @ApiPropertyOptional({ example: true, description: '¿Permite pagos? (opcional)' })
  @IsOptional()
  @IsBoolean()
  apiAccess?: boolean;

  @ApiPropertyOptional({ example: true, description: '¿Permite acceso API? (opcional)' })

  @IsOptional()
  @IsBoolean()

  @ApiPropertyOptional({ example: true, description: '¿Permite webhooks? (opcional)' })
  webhooks?: boolean;

  @IsOptional()

  @ApiPropertyOptional({ example: true, description: '¿Permite temas personalizados? (opcional)' })
  @IsBoolean()
  customThemes?: boolean;


  @ApiPropertyOptional({ example: true, description: '¿Permite analíticas avanzadas? (opcional)' })
  @IsOptional()
  @IsBoolean()
  advancedAnalytics?: boolean;
}

export class ThemeConfigDto {
  @ApiPropertyOptional({ example: 'sidebar', description: 'Layout de la tienda (opcional)' })
  @IsOptional()
  @IsIn(['sidebar', 'topbar', 'minimal'])
  layout?: 'sidebar' | 'topbar' | 'minimal';

  @ApiPropertyOptional({ example: 'expanded', description: 'Modo del sidebar (opcional)' })
  @IsOptional()
  @IsIn(['expanded', 'collapsed', 'overlay'])
  sidebarMode?: 'expanded' | 'collapsed' | 'overlay';

  @ApiPropertyOptional({ example: 'light', description: 'Esquema de color (opcional)' })
  @IsOptional()
  @IsIn(['light', 'dark', 'auto'])
  colorScheme?: 'light' | 'dark' | 'auto';

  @ApiPropertyOptional({ example: '8px', description: 'Border radius CSS (opcional)' })
  @IsOptional()
  @IsString()
  borderRadius?: string;

  @ApiPropertyOptional({ example: 'Inter, sans-serif', description: 'Fuente principal (opcional)' })
  @IsOptional()
  @IsString()
  fontFamily?: string;

  @ApiPropertyOptional({ example: '.custom { color: red; }', description: 'CSS personalizado (opcional)' })
  @IsOptional()
  @IsString()
  customCss?: string;
}

export class EcommerceConfigDto {
  @ApiPropertyOptional({ example: 'MXN', description: 'Moneda de la tienda (opcional)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'es-MX', description: 'Locale de la tienda (opcional)' })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional({ example: 'America/Mexico_City', description: 'Zona horaria (opcional)' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 'manual', description: 'Tipo de cálculo de impuestos (opcional)' })
  @IsOptional()
  @IsIn(['manual', 'automatic', 'disabled'])
  taxCalculation?: 'manual' | 'automatic' | 'disabled';

  @ApiPropertyOptional({ example: true, description: '¿Envíos habilitados? (opcional)' })
  @IsOptional()
  @IsBoolean()
  shippingEnabled?: boolean;

  @ApiPropertyOptional({ example: true, description: '¿Productos digitales habilitados? (opcional)' })
  @IsOptional()
  @IsBoolean()
  digitalProductsEnabled?: boolean;

  @ApiPropertyOptional({ example: true, description: '¿Subscripciones habilitadas? (opcional)' })
  @IsOptional()
  @IsBoolean()
  subscriptionsEnabled?: boolean;
}

export class IntegrationsConfigDto {
  @ApiPropertyOptional({ example: 'UA-123456', description: 'Google Analytics ID (opcional)' })
  @IsOptional()
  @IsString()
  googleAnalytics?: string;

  @ApiPropertyOptional({ example: 'GTM-ABC123', description: 'Google Tag Manager ID (opcional)' })
  @IsOptional()
  @IsString()
  googleTagManager?: string;

  @ApiPropertyOptional({ example: 'FB-PIXEL-123', description: 'Facebook Pixel ID (opcional)' })
  @IsOptional()
  @IsString()
  facebookPixel?: string;

  @ApiPropertyOptional({ example: '123456', description: 'Hotjar ID (opcional)' })
  @IsOptional()
  @IsString()
  hotjar?: string;

  @ApiPropertyOptional({ example: 'abc123', description: 'Intercom ID (opcional)' })
  @IsOptional()
  @IsString()
  intercom?: string;

  @ApiPropertyOptional({ example: 'crisp-123', description: 'Crisp ID (opcional)' })
  @IsOptional()
  @IsString()
  crisp?: string;
}

export class SecurityConfigDto {
  @ApiPropertyOptional({ example: true, description: '¿Forzar HTTPS? (opcional)' })
  @IsOptional()
  @IsBoolean()
  forceHttps?: boolean;

  @ApiPropertyOptional({ example: true, description: '¿HSTS habilitado? (opcional)' })
  @IsOptional()
  @IsBoolean()
  hsts?: boolean;

  @ApiPropertyOptional({ example: 'default-src https:', description: 'Content Security Policy (opcional)' })
  @IsOptional()
  @IsString()
  contentSecurityPolicy?: string;

  @ApiPropertyOptional({ example: ['https://ejemplo.com'], description: 'Orígenes permitidos (opcional)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];
}

export class PerformanceConfigDto {
  @ApiPropertyOptional({ example: 3600, description: 'TTL de caché en segundos (opcional)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(86400)
  cacheTtl?: number;

  @ApiPropertyOptional({ example: true, description: '¿CDN habilitado? (opcional)' })
  @IsOptional()
  @IsBoolean()
  cdnEnabled?: boolean;

  @ApiPropertyOptional({ example: true, description: '¿Compresión habilitada? (opcional)' })
  @IsOptional()
  @IsBoolean()
  compressionEnabled?: boolean;

  @ApiPropertyOptional({ example: true, description: '¿Carga diferida de imágenes? (opcional)' })
  @IsOptional()
  @IsBoolean()
  imageLazyLoading?: boolean;
}

export class CreateDomainConfigDto {
  @ApiPropertyOptional({ type: () => BrandingConfigDto, description: 'Configuración de branding (opcional)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingConfigDto)
  branding?: BrandingConfigDto;

  @ApiPropertyOptional({ type: () => SeoConfigDto, description: 'Configuración SEO (opcional)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SeoConfigDto)
  seo?: SeoConfigDto;

  @ApiPropertyOptional({ type: () => FeaturesConfigDto, description: 'Configuración de features (opcional)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeaturesConfigDto)
  features?: FeaturesConfigDto;

  @ApiPropertyOptional({ type: () => ThemeConfigDto, description: 'Configuración de tema (opcional)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ThemeConfigDto)
  theme?: ThemeConfigDto;

  @ApiPropertyOptional({ type: () => EcommerceConfigDto, description: 'Configuración ecommerce (opcional)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceConfigDto)
  ecommerce?: EcommerceConfigDto;

  @ApiPropertyOptional({ type: () => IntegrationsConfigDto, description: 'Configuración de integraciones (opcional)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationsConfigDto)
  integrations?: IntegrationsConfigDto;

  @ApiPropertyOptional({ type: () => SecurityConfigDto, description: 'Configuración de seguridad (opcional)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SecurityConfigDto)
  security?: SecurityConfigDto;

  @ApiPropertyOptional({ type: () => PerformanceConfigDto, description: 'Configuración de performance (opcional)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PerformanceConfigDto)
  performance?: PerformanceConfigDto;
}

export class CreateDomainSettingDto {
  @ApiProperty({ example: 'tienda.ejemplo.com', description: 'Hostname del dominio' })
  @IsString()
  @IsNotEmpty()
  hostname: string;

  @ApiProperty({ example: 1, description: 'ID de la organización' })
  @IsNumber()
  @IsNotEmpty()
  organizationId: number;

  @ApiPropertyOptional({ example: 1, description: 'ID de la tienda (opcional)' })
  @IsOptional()
  @IsNumber()
  storeId?: number;

  @ApiProperty({ type: () => CreateDomainConfigDto, description: 'Configuración del dominio' })
  @IsObject()
  @ValidateNested()
  @Type(() => CreateDomainConfigDto)
  config: CreateDomainConfigDto;
}

export class UpdateDomainSettingDto {
  @ApiPropertyOptional({ type: () => CreateDomainConfigDto, description: 'Configuración del dominio (opcional)' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateDomainConfigDto)
  config?: CreateDomainConfigDto;
}

export class ValidateHostnameDto {
  @ApiProperty({ example: 'tienda.ejemplo.com', description: 'Hostname a validar' })
  @IsString()
  @IsNotEmpty()
  hostname: string;
}

export class DuplicateDomainDto {
  @ApiProperty({ example: 'nueva-tienda.ejemplo.com', description: 'Nuevo hostname para duplicar' })
  @IsString()
  @IsNotEmpty()
  newHostname: string;
}
