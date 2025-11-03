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
exports.CategoryTreeDto = exports.AssignProductToCategoryDto = exports.CategoryQueryDto = exports.UpdateCategoryDto = exports.CreateCategoryDto = exports.CategoryStatus = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const mapped_types_1 = require("@nestjs/mapped-types");
const swagger_1 = require("@nestjs/swagger");
var CategoryStatus;
(function (CategoryStatus) {
    CategoryStatus["ACTIVE"] = "active";
    CategoryStatus["INACTIVE"] = "inactive";
})(CategoryStatus || (exports.CategoryStatus = CategoryStatus = {}));
class CreateCategoryDto {
    constructor() {
        this.is_featured = false;
        this.status = CategoryStatus.ACTIVE;
    }
}
exports.CreateCategoryDto = CreateCategoryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Ropa', description: 'Nombre de la categoría' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Categoría de ropa para adultos',
        description: 'Descripción de la categoría (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'ropa',
        description: 'Slug de la categoría (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "slug", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1, description: 'ID de la tienda' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateCategoryDto.prototype, "store_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 2,
        description: 'ID de la categoría padre (opcional)',
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateCategoryDto.prototype, "parent_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'https://ejemplo.com/categoria.jpg',
        description: 'URL de la imagen (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)(),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "image_url", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Ropa - Tienda',
        description: 'Meta título SEO (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "meta_title", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Encuentra la mejor ropa',
        description: 'Meta descripción SEO (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "meta_description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: ['ropa', 'moda'],
        description: 'Meta keywords SEO (opcional)',
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], CreateCategoryDto.prototype, "meta_keywords", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 0,
        description: 'Orden de la categoría (opcional)',
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateCategoryDto.prototype, "sort_order", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: false,
        description: '¿Es destacada? (opcional)',
    }),
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], CreateCategoryDto.prototype, "is_featured", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: CategoryStatus.ACTIVE,
        enum: CategoryStatus,
        description: 'Estado de la categoría (opcional)',
    }),
    (0, class_validator_1.IsEnum)(CategoryStatus),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "status", void 0);
class UpdateCategoryDto extends (0, mapped_types_1.PartialType)(CreateCategoryDto) {
}
exports.UpdateCategoryDto = UpdateCategoryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 1,
        description: 'ID de la tienda (opcional)',
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], UpdateCategoryDto.prototype, "store_id", void 0);
class CategoryQueryDto {
    constructor() {
        this.page = 1;
        this.limit = 10;
        this.sort_by = 'name';
        this.sort_order = 'asc';
        this.include_inactive = false;
    }
}
exports.CategoryQueryDto = CategoryQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1, description: 'Página (opcional)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CategoryQueryDto.prototype, "page", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 10,
        description: 'Límite de resultados por página (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CategoryQueryDto.prototype, "limit", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'camisa',
        description: 'Búsqueda por nombre (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CategoryQueryDto.prototype, "search", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 1,
        description: 'ID de la tienda (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CategoryQueryDto.prototype, "store_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 2,
        description: 'ID de la categoría padre (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CategoryQueryDto.prototype, "parent_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: CategoryStatus.ACTIVE,
        enum: CategoryStatus,
        description: 'Estado de la categoría (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(CategoryStatus),
    __metadata("design:type", String)
], CategoryQueryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: false,
        description: '¿Es destacada? (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CategoryQueryDto.prototype, "is_featured", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'name',
        description: 'Campo de ordenamiento (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CategoryQueryDto.prototype, "sort_by", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'asc',
        description: 'Orden (asc o desc) (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CategoryQueryDto.prototype, "sort_order", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: false,
        description: '¿Incluir inactivas? (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CategoryQueryDto.prototype, "include_inactive", void 0);
class AssignProductToCategoryDto {
    constructor() {
        this.sort_order = 0;
    }
}
exports.AssignProductToCategoryDto = AssignProductToCategoryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 10, description: 'ID del producto' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], AssignProductToCategoryDto.prototype, "product_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 0,
        description: 'Orden del producto en la categoría (opcional)',
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], AssignProductToCategoryDto.prototype, "sort_order", void 0);
class CategoryTreeDto {
}
exports.CategoryTreeDto = CategoryTreeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1, description: 'ID de la categoría' }),
    __metadata("design:type", Number)
], CategoryTreeDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Ropa', description: 'Nombre de la categoría' }),
    __metadata("design:type", String)
], CategoryTreeDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'ropa', description: 'Slug de la categoría' }),
    __metadata("design:type", String)
], CategoryTreeDto.prototype, "slug", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Categoría de ropa',
        description: 'Descripción de la categoría (opcional)',
    }),
    __metadata("design:type", String)
], CategoryTreeDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'https://ejemplo.com/categoria.jpg',
        description: 'URL de la imagen (opcional)',
    }),
    __metadata("design:type", String)
], CategoryTreeDto.prototype, "image_url", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: false, description: '¿Es destacada?' }),
    __metadata("design:type", Boolean)
], CategoryTreeDto.prototype, "is_featured", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 0, description: 'Orden de la categoría' }),
    __metadata("design:type", Number)
], CategoryTreeDto.prototype, "sort_order", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: CategoryStatus.ACTIVE,
        enum: CategoryStatus,
        description: 'Estado de la categoría',
    }),
    __metadata("design:type", String)
], CategoryTreeDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        type: () => [CategoryTreeDto],
        description: 'Subcategorías (opcional)',
    }),
    __metadata("design:type", Array)
], CategoryTreeDto.prototype, "children", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 10,
        description: 'Cantidad de productos (opcional)',
    }),
    __metadata("design:type", Number)
], CategoryTreeDto.prototype, "product_count", void 0);
//# sourceMappingURL=index.js.map