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
exports.PurchaseOrderQueryDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("@prisma/client");
class PurchaseOrderQueryDto {
}
exports.PurchaseOrderQueryDto = PurchaseOrderQueryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Organization ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PurchaseOrderQueryDto.prototype, "organization_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Store ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PurchaseOrderQueryDto.prototype, "store_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Supplier ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PurchaseOrderQueryDto.prototype, "supplier_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Location ID', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PurchaseOrderQueryDto.prototype, "location_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Purchase order status',
        enum: client_1.purchase_order_status_enum,
        required: false,
    }),
    (0, class_validator_1.IsEnum)(client_1.purchase_order_status_enum),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], PurchaseOrderQueryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Start date', required: false }),
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], PurchaseOrderQueryDto.prototype, "start_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'End date', required: false }),
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], PurchaseOrderQueryDto.prototype, "end_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Search term', required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], PurchaseOrderQueryDto.prototype, "search", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Minimum total amount', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PurchaseOrderQueryDto.prototype, "min_total", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Maximum total amount', required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], PurchaseOrderQueryDto.prototype, "max_total", void 0);
//# sourceMappingURL=purchase-order-query.dto.js.map