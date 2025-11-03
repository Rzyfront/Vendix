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
exports.BrandQueryDto = exports.UpdateBrandDto = exports.CreateBrandDto = exports.BrandStatus = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const mapped_types_1 = require("@nestjs/mapped-types");
var BrandStatus;
(function (BrandStatus) {
    BrandStatus["ACTIVE"] = "active";
    BrandStatus["INACTIVE"] = "inactive";
})(BrandStatus || (exports.BrandStatus = BrandStatus = {}));
class CreateBrandDto {
}
exports.CreateBrandDto = CreateBrandDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Nike', description: 'Nombre de la marca' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Marca deportiva internacional',
        description: 'Descripción de la marca (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'nike',
        description: 'Slug único de la marca (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "slug", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1, description: 'ID de la tienda asociada' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateBrandDto.prototype, "store_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'https://logo.com/nike.png',
        description: 'URL del logo de la marca (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)(),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "logo_url", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'https://nike.com',
        description: 'Sitio web de la marca (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)(),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "website_url", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Nike - Ropa y calzado',
        description: 'Meta título SEO (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "meta_title", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Marca líder en ropa deportiva',
        description: 'Meta descripción SEO (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "meta_description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 0,
        description: 'Orden de aparición (opcional)',
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateBrandDto.prototype, "sort_order", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: true,
        description: '¿Es marca destacada? (opcional)',
    }),
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], CreateBrandDto.prototype, "is_featured", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'active',
        description: 'Estado de la marca (opcional)',
    }),
    (0, class_validator_1.IsEnum)(BrandStatus),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "status", void 0);
class UpdateBrandDto extends (0, mapped_types_1.PartialType)(CreateBrandDto) {
}
exports.UpdateBrandDto = UpdateBrandDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], UpdateBrandDto.prototype, "store_id", void 0);
class BrandQueryDto {
    constructor() {
        this.page = 1;
        this.limit = 10;
        this.sort_by = 'name';
        this.sort_order = 'asc';
        this.include_inactive = false;
    }
}
exports.BrandQueryDto = BrandQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 1,
        description: 'Página de resultados (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], BrandQueryDto.prototype, "page", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 10,
        description: 'Cantidad de resultados por página (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], BrandQueryDto.prototype, "limit", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'nike',
        description: 'Búsqueda por nombre o slug (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BrandQueryDto.prototype, "search", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 1,
        description: 'Filtrar por ID de tienda (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], BrandQueryDto.prototype, "store_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'active',
        description: 'Filtrar por estado de la marca (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(BrandStatus),
    __metadata("design:type", String)
], BrandQueryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: true,
        description: 'Filtrar solo marcas destacadas (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], BrandQueryDto.prototype, "is_featured", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'name',
        description: 'Campo para ordenar (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BrandQueryDto.prototype, "sort_by", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BrandQueryDto.prototype, "sort_order", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], BrandQueryDto.prototype, "include_inactive", void 0);
//# sourceMappingURL=index.js.map