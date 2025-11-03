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
exports.RegisterOwnerDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class RegisterOwnerDto {
}
exports.RegisterOwnerDto = RegisterOwnerDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Mi Super Tienda',
        description: 'Nombre de la nueva organización',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'El nombre de la organización es requerido' }),
    __metadata("design:type", String)
], RegisterOwnerDto.prototype, "organization_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'usuario@email.com',
        description: 'Correo electrónico del usuario',
    }),
    (0, class_validator_1.IsEmail)({}, { message: 'Debe ser un email válido' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'El email es requerido' }),
    __metadata("design:type", String)
], RegisterOwnerDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Password@123',
        description: 'Contraseña del usuario (mínimo 8 caracteres, al menos un carácter especial)',
    }),
    (0, class_validator_1.IsString)({ message: 'La contraseña debe ser un string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'La contraseña es requerida' }),
    (0, class_validator_1.MinLength)(8, { message: 'La contraseña debe tener al menos 8 caracteres' }),
    (0, class_validator_1.Matches)(/[^A-Za-z0-9]/, {
        message: 'La contraseña debe contener al menos un carácter especial',
    }),
    (0, class_validator_1.Matches)(/[A-Z]/, {
        message: 'La contraseña debe contener al menos una letra mayúscula',
    }),
    __metadata("design:type", String)
], RegisterOwnerDto.prototype, "password", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Juan', description: 'Nombre del usuario' }),
    (0, class_validator_1.IsString)({ message: 'El nombre debe ser un string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'El nombre es requerido' }),
    __metadata("design:type", String)
], RegisterOwnerDto.prototype, "first_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Pérez', description: 'Apellido del usuario' }),
    (0, class_validator_1.IsString)({ message: 'El apellido debe ser un string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'El apellido es requerido' }),
    __metadata("design:type", String)
], RegisterOwnerDto.prototype, "last_name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: '+521234567890',
        description: 'Teléfono del usuario (opcional)',
    }),
    (0, class_validator_1.IsString)({ message: 'El teléfono debe ser un string' }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], RegisterOwnerDto.prototype, "phone", void 0);
//# sourceMappingURL=register-owner.dto.js.map