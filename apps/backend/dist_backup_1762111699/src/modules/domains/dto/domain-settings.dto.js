"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerifyDomainDto = exports.DuplicateDomainDto = exports.ValidateHostnameDto = exports.UpdateDomainSettingDto = exports.CreateDomainSettingDto = exports.CreateDomainConfigDto = exports.PerformanceConfigDto = exports.SecurityConfigDto = exports.IntegrationsConfigDto = exports.EcommerceConfigDto = exports.ThemeConfigDto = exports.FeaturesConfigDto = exports.SeoConfigDto = exports.BrandingConfigDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const swagger_1 = require("@nestjs/swagger");
class BrandingConfigDto {
}
exports.BrandingConfigDto = BrandingConfigDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Mi Empresa',
        description: 'Nombre de la empresa (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BrandingConfigDto.prototype, "companyName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Mi Tienda',
        description: 'Nombre de la tienda (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BrandingConfigDto.prototype, "storeName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'https://ejemplo.com/logo.png',
        description: 'URL del logo (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)(),
    __metadata("design:type", String)
], BrandingConfigDto.prototype, "logoUrl", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'https://ejemplo.com/favicon.ico',
        description: 'URL del favicon (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)(),
    __metadata("design:type", String)
], BrandingConfigDto.prototype, "favicon", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: '#007bff',
        description: 'Color primario (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BrandingConfigDto.prototype, "primaryColor", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: '#ffffff',
        description: 'Color secundario (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BrandingConfigDto.prototype, "secondaryColor", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: '#ff0000',
        description: 'Color de acento (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BrandingConfigDto.prototype, "accentColor", void 0);
class SeoConfigDto {
}
exports.SeoConfigDto = SeoConfigDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Página principal',
        description: 'Título SEO (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SeoConfigDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Descripción para SEO',
        description: 'Descripción SEO (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SeoConfigDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: ['ecommerce', 'tienda'],
        description: 'Palabras clave SEO (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], SeoConfigDto.prototype, "keywords", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'https://ejemplo.com/og.png',
        description: 'Imagen OpenGraph (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)(),
    __metadata("design:type", String)
], SeoConfigDto.prototype, "ogImage", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'website',
        description: 'Tipo OpenGraph (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SeoConfigDto.prototype, "ogType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'index,follow',
        description: 'Robots meta tag (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SeoConfigDto.prototype, "robots", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'https://ejemplo.com',
        description: 'Canonical URL (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)(),
    __metadata("design:type", String)
], SeoConfigDto.prototype, "canonicalUrl", void 0);
class FeaturesConfigDto {
}
exports.FeaturesConfigDto = FeaturesConfigDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "multiStore", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "userManagement", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "analytics", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "customDomain", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "inventory", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "pos", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "orders", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "customers", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "guestCheckout", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "wishlist", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "reviews", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "coupons", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "shipping", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "payments", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "apiAccess", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "webhooks", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "customThemes", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FeaturesConfigDto.prototype, "advancedAnalytics", void 0);
class ThemeConfigDto {
}
exports.ThemeConfigDto = ThemeConfigDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'sidebar' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['sidebar', 'topbar', 'minimal']),
    __metadata("design:type", String)
], ThemeConfigDto.prototype, "layout", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'expanded' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['expanded', 'collapsed', 'overlay']),
    __metadata("design:type", String)
], ThemeConfigDto.prototype, "sidebarMode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'light' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['light', 'dark', 'auto']),
    __metadata("design:type", String)
], ThemeConfigDto.prototype, "colorScheme", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '8px' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ThemeConfigDto.prototype, "borderRadius", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Inter, sans-serif' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ThemeConfigDto.prototype, "fontFamily", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '.custom { color: red; }' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ThemeConfigDto.prototype, "customCss", void 0);
class EcommerceConfigDto {
}
exports.EcommerceConfigDto = EcommerceConfigDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'MXN' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EcommerceConfigDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'es-MX' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EcommerceConfigDto.prototype, "locale", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'America/Mexico_City' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EcommerceConfigDto.prototype, "timezone", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'manual' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['manual', 'automatic', 'disabled']),
    __metadata("design:type", String)
], EcommerceConfigDto.prototype, "taxCalculation", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], EcommerceConfigDto.prototype, "shippingEnabled", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], EcommerceConfigDto.prototype, "digitalProductsEnabled", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], EcommerceConfigDto.prototype, "subscriptionsEnabled", void 0);
class IntegrationsConfigDto {
}
exports.IntegrationsConfigDto = IntegrationsConfigDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'UA-123456' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IntegrationsConfigDto.prototype, "googleAnalytics", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'GTM-ABC123' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IntegrationsConfigDto.prototype, "googleTagManager", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'FB-PIXEL-123' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IntegrationsConfigDto.prototype, "facebookPixel", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '123456' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IntegrationsConfigDto.prototype, "hotjar", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'abc123' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IntegrationsConfigDto.prototype, "intercom", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'crisp-123' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IntegrationsConfigDto.prototype, "crisp", void 0);
class SecurityConfigDto {
}
exports.SecurityConfigDto = SecurityConfigDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], SecurityConfigDto.prototype, "forceHttps", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], SecurityConfigDto.prototype, "hsts", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'default-src https:' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SecurityConfigDto.prototype, "contentSecurityPolicy", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: ['https://ejemplo.com'] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], SecurityConfigDto.prototype, "allowedOrigins", void 0);
class PerformanceConfigDto {
}
exports.PerformanceConfigDto = PerformanceConfigDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 3600 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(86400),
    __metadata("design:type", Number)
], PerformanceConfigDto.prototype, "cacheTtl", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PerformanceConfigDto.prototype, "cdnEnabled", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PerformanceConfigDto.prototype, "compressionEnabled", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PerformanceConfigDto.prototype, "imageLazyLoading", void 0);
class CreateDomainConfigDto {
}
exports.CreateDomainConfigDto = CreateDomainConfigDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: () => BrandingConfigDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => BrandingConfigDto),
    __metadata("design:type", BrandingConfigDto)
], CreateDomainConfigDto.prototype, "branding", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: () => SeoConfigDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => SeoConfigDto),
    __metadata("design:type", SeoConfigDto)
], CreateDomainConfigDto.prototype, "seo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: () => FeaturesConfigDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => FeaturesConfigDto),
    __metadata("design:type", FeaturesConfigDto)
], CreateDomainConfigDto.prototype, "features", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: () => ThemeConfigDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => ThemeConfigDto),
    __metadata("design:type", ThemeConfigDto)
], CreateDomainConfigDto.prototype, "theme", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: () => EcommerceConfigDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => EcommerceConfigDto),
    __metadata("design:type", EcommerceConfigDto)
], CreateDomainConfigDto.prototype, "ecommerce", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: () => IntegrationsConfigDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => IntegrationsConfigDto),
    __metadata("design:type", IntegrationsConfigDto)
], CreateDomainConfigDto.prototype, "integrations", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: () => SecurityConfigDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => SecurityConfigDto),
    __metadata("design:type", SecurityConfigDto)
], CreateDomainConfigDto.prototype, "security", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: () => PerformanceConfigDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => PerformanceConfigDto),
    __metadata("design:type", PerformanceConfigDto)
], CreateDomainConfigDto.prototype, "performance", void 0);
class CreateDomainSettingDto {
}
exports.CreateDomainSettingDto = CreateDomainSettingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'tienda.ejemplo.com' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateDomainSettingDto.prototype, "hostname", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'ecommerce' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['vendix_core', 'organization', 'store', 'ecommerce']),
    __metadata("design:type", String)
], CreateDomainSettingDto.prototype, "domainType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'pending_dns' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['pending_dns', 'pending_ssl', 'active', 'disabled']),
    __metadata("design:type", String)
], CreateDomainSettingDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'none' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['none', 'pending', 'issued', 'error', 'revoked']),
    __metadata("design:type", String)
], CreateDomainSettingDto.prototype, "sslStatus", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateDomainSettingDto.prototype, "isPrimary", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'vendix_subdomain' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)([
        'vendix_subdomain',
        'custom_domain',
        'custom_subdomain',
        'vendix_core',
        'third_party_subdomain',
    ]),
    __metadata("design:type", String)
], CreateDomainSettingDto.prototype, "ownership", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Number)
], CreateDomainSettingDto.prototype, "organizationId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], CreateDomainSettingDto.prototype, "storeId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: () => CreateDomainConfigDto }),
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => CreateDomainConfigDto),
    __metadata("design:type", CreateDomainConfigDto)
], CreateDomainSettingDto.prototype, "config", void 0);
class UpdateDomainSettingDto {
}
exports.UpdateDomainSettingDto = UpdateDomainSettingDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: () => CreateDomainConfigDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => CreateDomainConfigDto),
    __metadata("design:type", CreateDomainConfigDto)
], UpdateDomainSettingDto.prototype, "config", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['vendix_core', 'organization', 'store', 'ecommerce']),
    __metadata("design:type", String)
], UpdateDomainSettingDto.prototype, "domainType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['pending_dns', 'pending_ssl', 'active', 'disabled']),
    __metadata("design:type", String)
], UpdateDomainSettingDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['none', 'pending', 'issued', 'error', 'revoked']),
    __metadata("design:type", String)
], UpdateDomainSettingDto.prototype, "sslStatus", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateDomainSettingDto.prototype, "isPrimary", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)([
        'vendix_subdomain',
        'custom_domain',
        'custom_subdomain',
        'vendix_core',
        'third_party_subdomain',
    ]),
    __metadata("design:type", String)
], UpdateDomainSettingDto.prototype, "ownership", void 0);
class ValidateHostnameDto {
}
exports.ValidateHostnameDto = ValidateHostnameDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'tienda.ejemplo.com' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ValidateHostnameDto.prototype, "hostname", void 0);
class DuplicateDomainDto {
}
exports.DuplicateDomainDto = DuplicateDomainDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'nueva-tienda.ejemplo.com' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], DuplicateDomainDto.prototype, "newHostname", void 0);
class VerifyDomainDto {
}
exports.VerifyDomainDto = VerifyDomainDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsIn)(['txt', 'cname', 'a', 'aaaa'], { each: true }),
    __metadata("design:type", Array)
], VerifyDomainDto.prototype, "checks", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], VerifyDomainDto.prototype, "force", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], VerifyDomainDto.prototype, "expectedCname", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], VerifyDomainDto.prototype, "expectedA", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], VerifyDomainDto.prototype, "mode", void 0);
//# sourceMappingURL=domain-settings.dto.js.map