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
exports.MovementQueryDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("@prisma/client");
class MovementQueryDto {
}
exports.MovementQueryDto = MovementQueryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Organization ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], MovementQueryDto.prototype, "organization_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Store ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], MovementQueryDto.prototype, "store_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Product ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], MovementQueryDto.prototype, "product_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Product variant ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], MovementQueryDto.prototype, "product_variant_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'From location ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], MovementQueryDto.prototype, "from_location_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'To location ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], MovementQueryDto.prototype, "to_location_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Movement type',
        enum: client_1.movement_type_enum,
        required: false,
    }),
    (0, class_validator_1.IsEnum)(client_1.movement_type_enum),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], MovementQueryDto.prototype, "movement_type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'User ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], MovementQueryDto.prototype, "user_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Start date', required: false }),
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], MovementQueryDto.prototype, "start_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'End date', required: false }),
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], MovementQueryDto.prototype, "end_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Search term', required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], MovementQueryDto.prototype, "search", void 0);
//# sourceMappingURL=movement-query.dto.js.map