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
exports.TaxCalculationResultDto = exports.TaxCalculationDto = exports.TaxCategoryQueryDto = exports.UpdateTaxCategoryDto = exports.CreateTaxCategoryDto = exports.TaxType = exports.TaxStatus = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const mapped_types_1 = require("@nestjs/mapped-types");
var TaxStatus;
(function (TaxStatus) {
    TaxStatus["ACTIVE"] = "active";
    TaxStatus["INACTIVE"] = "inactive";
})(TaxStatus || (exports.TaxStatus = TaxStatus = {}));
var TaxType;
(function (TaxType) {
    TaxType["PERCENTAGE"] = "percentage";
    TaxType["FIXED"] = "fixed";
})(TaxType || (exports.TaxType = TaxType = {}));
class CreateTaxCategoryDto {
    constructor() {
        this.is_inclusive = false;
        this.is_compound = false;
        this.sort_order = 0;
        this.status = TaxStatus.ACTIVE;
    }
}
exports.CreateTaxCategoryDto = CreateTaxCategoryDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateTaxCategoryDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateTaxCategoryDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(TaxType),
    __metadata("design:type", String)
], CreateTaxCategoryDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsNumber)({ maxDecimalPlaces: 4 }),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateTaxCategoryDto.prototype, "rate", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateTaxCategoryDto.prototype, "store_id", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateTaxCategoryDto.prototype, "organization_id", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], CreateTaxCategoryDto.prototype, "is_inclusive", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], CreateTaxCategoryDto.prototype, "is_compound", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateTaxCategoryDto.prototype, "sort_order", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(TaxStatus),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateTaxCategoryDto.prototype, "status", void 0);
class UpdateTaxCategoryDto extends (0, mapped_types_1.PartialType)(CreateTaxCategoryDto) {
}
exports.UpdateTaxCategoryDto = UpdateTaxCategoryDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], UpdateTaxCategoryDto.prototype, "store_id", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], UpdateTaxCategoryDto.prototype, "organization_id", void 0);
class TaxCategoryQueryDto {
    constructor() {
        this.page = 1;
        this.limit = 10;
        this.sort_by = 'sort_order';
        this.sort_order = 'asc';
        this.include_inactive = false;
    }
}
exports.TaxCategoryQueryDto = TaxCategoryQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], TaxCategoryQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], TaxCategoryQueryDto.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TaxCategoryQueryDto.prototype, "search", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], TaxCategoryQueryDto.prototype, "store_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], TaxCategoryQueryDto.prototype, "organization_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(TaxType),
    __metadata("design:type", String)
], TaxCategoryQueryDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(TaxStatus),
    __metadata("design:type", String)
], TaxCategoryQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], TaxCategoryQueryDto.prototype, "is_inclusive", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], TaxCategoryQueryDto.prototype, "is_compound", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TaxCategoryQueryDto.prototype, "sort_by", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TaxCategoryQueryDto.prototype, "sort_order", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], TaxCategoryQueryDto.prototype, "include_inactive", void 0);
class TaxCalculationDto {
}
exports.TaxCalculationDto = TaxCalculationDto;
__decorate([
    (0, class_validator_1.IsNumber)({ maxDecimalPlaces: 2 }),
    (0, class_validator_1.Min)(0),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], TaxCalculationDto.prototype, "subtotal", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], TaxCalculationDto.prototype, "store_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], TaxCalculationDto.prototype, "product_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], TaxCalculationDto.prototype, "shipping_address_id", void 0);
class TaxCalculationResultDto {
}
exports.TaxCalculationResultDto = TaxCalculationResultDto;
//# sourceMappingURL=index.js.map