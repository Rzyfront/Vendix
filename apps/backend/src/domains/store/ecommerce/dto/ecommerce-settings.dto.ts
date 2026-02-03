import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsObject,
  IsHexColor,
  IsNumber,
  IsArray,
  MaxLength,
  ValidateNested,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para branding independiente del ecommerce
 * Separado del branding de tienda (STORE_ADMIN)
 */
export class EcommerceBrandingDto {
  @ApiPropertyOptional({
    example: 'Mi Tienda Online',
    description: 'Nombre de la tienda para el ecommerce',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: '#3B82F6',
    description: 'Primary color',
  })
  @IsOptional()
  @IsHexColor()
  primary_color?: string;

  @ApiPropertyOptional({
    example: '#10B981',
    description: 'Secondary color',
  })
  @IsOptional()
  @IsHexColor()
  secondary_color?: string;

  @ApiPropertyOptional({
    example: '#F59E0B',
    description: 'Accent color',
  })
  @IsOptional()
  @IsHexColor()
  accent_color?: string;

  @ApiPropertyOptional({
    example: '#F4F4F4',
    description: 'Background color',
  })
  @IsOptional()
  @IsHexColor()
  background_color?: string;

  @ApiPropertyOptional({
    example: '#FFFFFF',
    description: 'Surface color',
  })
  @IsOptional()
  @IsHexColor()
  surface_color?: string;

  @ApiPropertyOptional({
    example: '#222222',
    description: 'Text color',
  })
  @IsOptional()
  @IsHexColor()
  text_color?: string;

  @ApiPropertyOptional({
    example: '#666666',
    description: 'Text secondary color',
  })
  @IsOptional()
  @IsHexColor()
  text_secondary_color?: string;

  @ApiPropertyOptional({
    example: '#999999',
    description: 'Text muted color',
  })
  @IsOptional()
  @IsHexColor()
  text_muted_color?: string;

  @ApiPropertyOptional({
    example: 'https://ejemplo.com/logo.png',
    description: 'URL del logo',
  })
  @IsOptional()
  @IsString()
  logo_url?: string;

  @ApiPropertyOptional({
    example: 'https://ejemplo.com/favicon.ico',
    description: 'URL del favicon',
  })
  @IsOptional()
  @IsString()
  favicon_url?: string;

  @ApiPropertyOptional({
    example: '.custom-class { color: red; }',
    description: 'Custom CSS',
  })
  @IsOptional()
  @IsString()
  custom_css?: string;
}

/**
 * DTO para los colores de la sección inicio
 * @deprecated Use EcommerceBrandingDto instead
 */
export class InicioColoresDto {
  @ApiPropertyOptional({
    example: '#3B82F6',
    description: 'Primary color',
  })
  @IsOptional()
  @IsHexColor()
  primary_color?: string;

  @ApiPropertyOptional({
    example: '#10B981',
    description: 'Secondary color',
  })
  @IsOptional()
  @IsHexColor()
  secondary_color?: string;

  @ApiPropertyOptional({
    example: '#F59E0B',
    description: 'Accent color',
  })
  @IsOptional()
  @IsHexColor()
  accent_color?: string;
}

/**
 * DTO para la sección inicio de e-commerce
 */
export class InicioDto {
  @ApiPropertyOptional({
    example: 'Bienvenido a Mi Tienda',
    description: 'Título de la página de inicio',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  titulo?: string;

  @ApiPropertyOptional({
    example:
      'Encuentra aquí todo lo que buscas y si no lo encuentras pregúntanos...',
    description: 'Párrafo descriptivo de la página de inicio',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  parrafo?: string;

  @ApiPropertyOptional({
    example: 'https://ejemplo.com/logo.png',
    description: 'URL del logo',
  })
  @IsOptional()
  @IsString()
  logo_url?: string | null;

  @ApiPropertyOptional({
    description: 'Colores de la marca',
    type: InicioColoresDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InicioColoresDto)
  colores?: InicioColoresDto;
}

/**
 * DTO para las configuraciones generales de e-commerce
 */
export class EcommerceGeneralDto {
  @ApiPropertyOptional({
    example: 'COP',
    description: 'Currency code (ISO 4217)',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    example: 'es-CO',
    description: 'Locale code (BCP 47)',
  })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional({
    example: 'America/Bogota',
    description: 'Timezone (IANA)',
  })
  @IsOptional()
  @IsString()
  timezone?: string;
}

/**
 * DTO para una foto del slider
 */
export class SliderPhotoDto {
  @ApiPropertyOptional({ description: 'Image URL (S3 key or public URL)' })
  @IsOptional()
  @IsString()
  url?: string | null;

  @ApiPropertyOptional({ description: 'Title to display over the image' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Caption/description for the image' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

/**
 * DTO para la configuración del slider
 */
export class EcommerceSliderDto {
  @ApiPropertyOptional({ example: false, description: 'Enable slider' })
  @IsOptional()
  @IsBoolean()
  enable?: boolean;

  @ApiPropertyOptional({ description: 'Array of slider photos (max 5)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SliderPhotoDto)
  photos?: SliderPhotoDto[];
}

/**
 * DTO para la configuración del catálogo
 */
export class EcommerceCatalogDto {
  @ApiPropertyOptional({ example: 12, description: 'Products per page' })
  @IsOptional()
  @IsNumber()
  products_per_page?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Show out of stock products',
  })
  @IsOptional()
  @IsBoolean()
  show_out_of_stock?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Allow product reviews' })
  @IsOptional()
  @IsBoolean()
  allow_reviews?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Show product variants' })
  @IsOptional()
  @IsBoolean()
  show_variants?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Show related products' })
  @IsOptional()
  @IsBoolean()
  show_related_products?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Enable product filters' })
  @IsOptional()
  @IsBoolean()
  enable_filters?: boolean;
}

/**
 * DTO para la configuración del carrito
 */
export class EcommerceCartDto {
  @ApiPropertyOptional({ example: true, description: 'Allow guest checkout' })
  @IsOptional()
  @IsBoolean()
  allow_guest_checkout?: boolean;

  @ApiPropertyOptional({ example: 24, description: 'Cart expiration in hours' })
  @IsOptional()
  @IsNumber()
  cart_expiration_hours?: number;

  @ApiPropertyOptional({ example: 10, description: 'Max quantity per item' })
  @IsOptional()
  @IsNumber()
  max_quantity_per_item?: number;

  @ApiPropertyOptional({ example: true, description: 'Enable save for later' })
  @IsOptional()
  @IsBoolean()
  save_for_later?: boolean;
}

/**
 * DTO para la configuración del checkout
 */
export class EcommerceCheckoutDto {
  @ApiPropertyOptional({ example: false, description: 'Require registration' })
  @IsOptional()
  @IsBoolean()
  require_registration?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Guest email required' })
  @IsOptional()
  @IsBoolean()
  guest_email_required?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Create account after order',
  })
  @IsOptional()
  @IsBoolean()
  create_account_after_order?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Terms required' })
  @IsOptional()
  @IsBoolean()
  terms_required?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Guest newsletter opt-in',
  })
  @IsOptional()
  @IsBoolean()
  guest_newsletter_opt_in?: boolean;
}

/**
 * DTO para la configuración de envíos
 */
export class EcommerceShippingDto {
  @ApiPropertyOptional({ example: 100, description: 'Free shipping threshold' })
  @IsOptional()
  @IsNumber()
  free_shipping_threshold?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Calculate tax before shipping',
  })
  @IsOptional()
  @IsBoolean()
  calculate_tax_before_shipping?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Multiple shipping addresses',
  })
  @IsOptional()
  @IsBoolean()
  multiple_shipping_addresses?: boolean;
}

/**
 * DTO para la configuración de la lista de deseos
 */
export class EcommerceWishlistDto {
  @ApiPropertyOptional({ example: true, description: 'Wishlist enabled' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Public wishlist' })
  @IsOptional()
  @IsBoolean()
  public_wishlist?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Share wishlist' })
  @IsOptional()
  @IsBoolean()
  share_wishlist?: boolean;
}

/**
 * DTO principal para configuración de e-commerce
 * Contiene todas las secciones de configuración
 */
export class EcommerceSettingsDto {
  @ApiPropertyOptional({
    example: 'STORE_ECOMMERCE',
    description: 'App type identifier',
  })
  @IsOptional()
  @IsString()
  @IsIn(['STORE_ECOMMERCE'])
  app?: string;

  // Branding independiente del ecommerce (separado del branding de tienda)
  @ApiPropertyOptional({
    description: 'Branding settings for ecommerce (independent from store branding)',
    type: EcommerceBrandingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceBrandingDto)
  branding?: EcommerceBrandingDto;

  // Sección Inicio
  @ApiPropertyOptional({
    description: 'Configuración de inicio (título, párrafo, logo, colores)',
    type: InicioDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InicioDto)
  inicio?: InicioDto;

  // Configuración General
  @ApiPropertyOptional({
    description: 'General settings (currency, locale, timezone)',
    type: EcommerceGeneralDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceGeneralDto)
  general?: EcommerceGeneralDto;

  // Slider
  @ApiPropertyOptional({
    description: 'Slider configuration with photos',
    type: EcommerceSliderDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceSliderDto)
  slider?: EcommerceSliderDto;

  // Catálogo
  @ApiPropertyOptional({
    description: 'Catalog settings',
    type: EcommerceCatalogDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceCatalogDto)
  catalog?: EcommerceCatalogDto;

  // Carrito
  @ApiPropertyOptional({ description: 'Cart settings', type: EcommerceCartDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceCartDto)
  cart?: EcommerceCartDto;

  // Checkout
  @ApiPropertyOptional({
    description: 'Checkout settings',
    type: EcommerceCheckoutDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceCheckoutDto)
  checkout?: EcommerceCheckoutDto;

  // Envíos
  @ApiPropertyOptional({
    description: 'Shipping settings',
    type: EcommerceShippingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceShippingDto)
  shipping?: EcommerceShippingDto;

}

export class UpdateEcommerceSettingsDto {
  @IsObject()
  ecommerce: EcommerceSettingsDto;
}
