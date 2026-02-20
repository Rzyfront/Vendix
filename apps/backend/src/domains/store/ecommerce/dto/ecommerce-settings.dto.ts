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
  IsEmail,
  IsUrl,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para los colores de la sección inicio (única fuente de verdad para branding ecommerce)
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

  @ApiPropertyOptional({
    example: false,
    description: 'Enable WhatsApp checkout',
  })
  @IsOptional()
  @IsBoolean()
  whatsapp_checkout?: boolean;

  @ApiPropertyOptional({
    example: '+57 300 123 4567',
    description: 'WhatsApp number for checkout orders',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[\d+#*\s()-]*$/, { message: 'El número de WhatsApp solo puede contener números y los símbolos + # * ( ) -' })
  whatsapp_number?: string;
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

// ============================================================================
// FOOTER DTOs - Configuración del pie de página del ecommerce
// ============================================================================

/**
 * DTO para información de la tienda en el footer
 */
export class FooterStoreInfoDto {
  @ApiPropertyOptional({
    example: 'Somos una tienda dedicada a ofrecer productos de alta calidad...',
    description: 'Descripción sobre la tienda (se muestra en modal About Us)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about_us?: string;

  @ApiPropertyOptional({
    example: 'soporte@mitienda.com',
    description: 'Email de soporte para customers',
  })
  @IsOptional()
  @ValidateIf((o) => !!o.support_email)
  @IsEmail()
  support_email?: string;

  @ApiPropertyOptional({
    example: 'Tu tienda de confianza para productos de calidad',
    description: 'Frase corta que aparece en el footer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tagline?: string;
}

/**
 * DTO para un enlace del footer
 */
export class FooterLinkDto {
  @ApiPropertyOptional({
    example: 'Productos',
    description: 'Texto del enlace',
  })
  @IsString()
  @MaxLength(50)
  label: string;

  @ApiPropertyOptional({
    example: '/products',
    description: 'URL del enlace (interna o externa)',
  })
  @IsString()
  @MaxLength(500)
  url: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Si es un enlace externo (abre en nueva ventana)',
  })
  @IsOptional()
  @IsBoolean()
  is_external?: boolean;
}

/**
 * DTO para un item de FAQ
 */
export class FooterFaqItemDto {
  @ApiPropertyOptional({
    example: '¿Cómo puedo realizar un pedido?',
    description: 'Pregunta frecuente',
  })
  @IsString()
  @MaxLength(300)
  question: string;

  @ApiPropertyOptional({
    example: 'Puedes realizar tu pedido navegando por nuestro catálogo...',
    description: 'Respuesta a la pregunta',
  })
  @IsString()
  @MaxLength(2000)
  answer: string;
}

/**
 * DTO para la sección de ayuda del footer
 */
export class FooterHelpDto {
  @ApiPropertyOptional({
    description: 'Lista de preguntas frecuentes',
    type: [FooterFaqItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FooterFaqItemDto)
  faq?: FooterFaqItemDto[];

  @ApiPropertyOptional({
    example: 'Realizamos envíos a todo el país. El tiempo de entrega varía...',
    description: 'Información sobre envíos',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  shipping_info?: string;

  @ApiPropertyOptional({
    example: 'Si no estás satisfecho con tu compra, puedes solicitar una devolución...',
    description: 'Política de devoluciones',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  returns_info?: string;
}

/**
 * DTO para una cuenta de red social
 */
export class FooterSocialAccountDto {
  @ApiPropertyOptional({
    example: 'mitienda',
    description: 'Nombre de usuario en la red social',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  username?: string;

  @ApiPropertyOptional({
    example: 'https://facebook.com/mitienda',
    description: 'URL del perfil en la red social',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;
}

/**
 * DTO para las redes sociales del footer
 */
export class FooterSocialDto {
  @ApiPropertyOptional({
    description: 'Cuenta de Facebook',
    type: FooterSocialAccountDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FooterSocialAccountDto)
  facebook?: FooterSocialAccountDto;

  @ApiPropertyOptional({
    description: 'Cuenta de Instagram',
    type: FooterSocialAccountDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FooterSocialAccountDto)
  instagram?: FooterSocialAccountDto;

  @ApiPropertyOptional({
    description: 'Cuenta de TikTok',
    type: FooterSocialAccountDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FooterSocialAccountDto)
  tiktok?: FooterSocialAccountDto;
}

/**
 * DTO principal para la configuración del footer
 */
export class FooterSettingsDto {
  @ApiPropertyOptional({
    description: 'Información de la tienda',
    type: FooterStoreInfoDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FooterStoreInfoDto)
  store_info?: FooterStoreInfoDto;

  @ApiPropertyOptional({
    description: 'Enlaces de interés (máx 5)',
    type: [FooterLinkDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FooterLinkDto)
  links?: FooterLinkDto[];

  @ApiPropertyOptional({
    description: 'Sección de ayuda (FAQ, envíos, devoluciones)',
    type: FooterHelpDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FooterHelpDto)
  help?: FooterHelpDto;

  @ApiPropertyOptional({
    description: 'Redes sociales',
    type: FooterSocialDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FooterSocialDto)
  social?: FooterSocialDto;
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

  @ApiPropertyOptional({
    example: true,
    description: 'Enable ecommerce module',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Sección Inicio - Contiene colores (único source of truth para branding)
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

  // Footer
  @ApiPropertyOptional({
    description: 'Footer settings',
    type: FooterSettingsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FooterSettingsDto)
  footer?: FooterSettingsDto;

  // Branding - Colores de marca para ecommerce (legacy, usar inicio.colores)
  @ApiPropertyOptional({
    description: 'Branding colors (deprecated, use inicio.colores instead)',
    type: InicioColoresDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InicioColoresDto)
  branding?: InicioColoresDto;
}

export class UpdateEcommerceSettingsDto {
  @IsObject()
  ecommerce: EcommerceSettingsDto;
}
