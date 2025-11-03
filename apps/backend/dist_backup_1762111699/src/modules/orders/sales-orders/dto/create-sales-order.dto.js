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
exports.CreateSalesOrderDto = exports.SalesOrderItemDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("@prisma/client");
class SalesOrderItemDto {
}
exports.SalesOrderItemDto = SalesOrderItemDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Product ID' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Number)
], SalesOrderItemDto.prototype, "product_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Product variant ID (optional)' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], SalesOrderItemDto.prototype, "product_variant_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Quantity ordered' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Number)
], SalesOrderItemDto.prototype, "quantity", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Unit price' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Number)
], SalesOrderItemDto.prototype, "unit_price", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Discount percentage (optional)' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], SalesOrderItemDto.prototype, "discount_percentage", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Tax rate (optional)' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], SalesOrderItemDto.prototype, "tax_rate", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Location ID to fulfill from' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], SalesOrderItemDto.prototype, "location_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Notes for this item (optional)' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SalesOrderItemDto.prototype, "notes", void 0);
class CreateSalesOrderDto {
    constructor() {
        this.status = client_1.sales_order_status_enum.draft;
    }
}
exports.CreateSalesOrderDto = CreateSalesOrderDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Customer ID' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateSalesOrderDto.prototype, "customer_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Customer email (for guest orders)' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "customer_email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Customer name (for guest orders)' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "customer_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Sales order status',
        enum: client_1.sales_order_status_enum,
    }),
    (0, class_validator_1.IsEnum)(client_1.sales_order_status_enum),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Order date' }),
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "order_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Expected delivery date' }),
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "expected_delivery_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Shipping address ID' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateSalesOrderDto.prototype, "shipping_address_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Billing address ID' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateSalesOrderDto.prototype, "billing_address_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Payment method' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "payment_method", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Payment status' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "payment_status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Shipping method' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "shipping_method", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Shipping cost' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateSalesOrderDto.prototype, "shipping_cost", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Tax amount' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateSalesOrderDto.prototype, "tax_amount", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Discount amount' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateSalesOrderDto.prototype, "discount_amount", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Notes' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "notes", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Internal reference number' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "internal_reference", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Customer reference number' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateSalesOrderDto.prototype, "customer_reference", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Sales order items', type: [SalesOrderItemDto] }),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => SalesOrderItemDto),
    __metadata("design:type", Array)
], CreateSalesOrderDto.prototype, "items", void 0);
//# sourceMappingURL=create-sales-order.dto.js.map