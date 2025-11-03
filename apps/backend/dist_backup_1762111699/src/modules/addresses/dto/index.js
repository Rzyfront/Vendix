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
exports.UpdateGPSCoordinatesDto = exports.AddressQueryDto = exports.UpdateAddressDto = exports.CreateAddressDto = exports.AddressType = exports.AddressStatus = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const mapped_types_1 = require("@nestjs/mapped-types");
var AddressStatus;
(function (AddressStatus) {
    AddressStatus["ACTIVE"] = "active";
    AddressStatus["INACTIVE"] = "inactive";
})(AddressStatus || (exports.AddressStatus = AddressStatus = {}));
var AddressType;
(function (AddressType) {
    AddressType["BILLING"] = "billing";
    AddressType["SHIPPING"] = "shipping";
    AddressType["HEADQUARTERS"] = "headquarters";
    AddressType["BRANCH_OFFICE"] = "branch_office";
    AddressType["WAREHOUSE"] = "warehouse";
    AddressType["LEGAL"] = "legal";
    AddressType["STORE_PHYSICAL"] = "store_physical";
})(AddressType || (exports.AddressType = AddressType = {}));
class CreateAddressDto {
}
exports.CreateAddressDto = CreateAddressDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Calle 123',
        description: 'Línea principal de la dirección',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "address_line_1", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Depto 4B',
        description: 'Línea secundaria de la dirección (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "address_line_2", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Ciudad de México', description: 'Ciudad' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "city", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'CDMX', description: 'Estado o provincia' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "state", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '01234', description: 'Código postal' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "postal_code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'México', description: 'País' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "country", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'shipping',
        description: 'Tipo de dirección (opcional)',
    }),
    (0, class_validator_1.IsEnum)(AddressType),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1, description: 'ID de cliente (opcional)' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateAddressDto.prototype, "customer_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1, description: 'ID de tienda (opcional)' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateAddressDto.prototype, "store_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 1,
        description: 'ID de organización (opcional)',
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateAddressDto.prototype, "organization_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 1, description: 'ID de usuario (opcional)' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateAddressDto.prototype, "user_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: false,
        description: '¿Es dirección principal? (opcional)',
    }),
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], CreateAddressDto.prototype, "is_primary", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: '19.4326',
        description: 'Latitud (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsLatLong)(),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "latitude", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: '-99.1332',
        description: 'Longitud (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsLatLong)(),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "longitude", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Frente a parque',
        description: 'Referencia o punto de interés (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "landmark", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Dejar con portero',
        description: 'Instrucciones de entrega (opcional)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "delivery_instructions", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'active',
        description: 'Estado de la dirección (opcional)',
    }),
    (0, class_validator_1.IsEnum)(AddressStatus),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateAddressDto.prototype, "status", void 0);
class UpdateAddressDto extends (0, mapped_types_1.PartialType)(CreateAddressDto) {
}
exports.UpdateAddressDto = UpdateAddressDto;
class AddressQueryDto {
    constructor() {
        this.page = 1;
        this.limit = 10;
        this.sort_by = 'created_at';
        this.sort_order = 'desc';
        this.include_inactive = false;
    }
}
exports.AddressQueryDto = AddressQueryDto;
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
], AddressQueryDto.prototype, "page", void 0);
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
], AddressQueryDto.prototype, "limit", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'parque',
        description: 'Búsqueda por texto (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddressQueryDto.prototype, "search", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 1,
        description: 'Filtrar por ID de cliente (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => parseInt(value)),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], AddressQueryDto.prototype, "customer_id", void 0);
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
], AddressQueryDto.prototype, "store_id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'shipping',
        description: 'Filtrar por tipo de dirección (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(AddressType),
    __metadata("design:type", String)
], AddressQueryDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'active',
        description: 'Filtrar por estado de dirección (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(AddressStatus),
    __metadata("design:type", String)
], AddressQueryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: false,
        description: 'Filtrar por dirección principal (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AddressQueryDto.prototype, "is_primary", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Ciudad de México',
        description: 'Filtrar por ciudad (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddressQueryDto.prototype, "city", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'CDMX',
        description: 'Filtrar por estado (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddressQueryDto.prototype, "state", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'México',
        description: 'Filtrar por país (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddressQueryDto.prototype, "country", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'created_at',
        description: 'Campo para ordenar (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddressQueryDto.prototype, "sort_by", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'desc',
        description: 'Orden ascendente o descendente (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddressQueryDto.prototype, "sort_order", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: false,
        description: 'Incluir direcciones inactivas (opcional)',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], AddressQueryDto.prototype, "include_inactive", void 0);
class UpdateGPSCoordinatesDto {
}
exports.UpdateGPSCoordinatesDto = UpdateGPSCoordinatesDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsLatLong)(),
    __metadata("design:type", String)
], UpdateGPSCoordinatesDto.prototype, "latitude", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsLatLong)(),
    __metadata("design:type", String)
], UpdateGPSCoordinatesDto.prototype, "longitude", void 0);
//# sourceMappingURL=index.js.map