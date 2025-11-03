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
exports.RegisterCustomerDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class RegisterCustomerDto {
}
exports.RegisterCustomerDto = RegisterCustomerDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'cliente@email.com',
        description: 'Correo electrónico del cliente',
    }),
    (0, class_validator_1.IsEmail)({}, { message: 'Debe ser un email válido' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'El email es requerido' }),
    __metadata("design:type", String)
], RegisterCustomerDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Password@123',
        description: 'Contraseña del cliente (mínimo 8 caracteres, al menos un carácter especial)',
    }),
    (0, class_validator_1.IsString)({ message: 'La contraseña debe ser un string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'La contraseña es requerida' }),
    (0, class_validator_1.MinLength)(8, { message: 'La contraseña debe tener al menos 8 caracteres' }),
    (0, class_validator_1.Matches)(/[^A-Za-z0-9]/, {
        message: 'La contraseña debe contener al menos un carácter especial',
    }),
    __metadata("design:type", String)
], RegisterCustomerDto.prototype, "password", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Juan', description: 'Nombre del cliente' }),
    (0, class_validator_1.IsString)({ message: 'El nombre debe ser un string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'El nombre es requerido' }),
    __metadata("design:type", String)
], RegisterCustomerDto.prototype, "first_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Pérez', description: 'Apellido del cliente' }),
    (0, class_validator_1.IsString)({ message: 'El apellido debe ser un string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'El apellido es requerido' }),
    __metadata("design:type", String)
], RegisterCustomerDto.prototype, "last_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 1,
        description: 'ID de la tienda donde se registra el cliente',
    }),
    (0, class_validator_1.IsNumber)({}, { message: 'El ID de la tienda debe ser un número' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'El ID de la tienda es requerido' }),
    __metadata("design:type", Number)
], RegisterCustomerDto.prototype, "store_id", void 0);
//# sourceMappingURL=register-customer.dto.js.map