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
exports.LoginDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class LoginDto {
}
exports.LoginDto = LoginDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'usuario@email.com',
        description: 'Correo electrónico del usuario',
    }),
    (0, class_validator_1.IsEmail)({}, { message: 'Debe ser un email válido' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'El email es requerido' }),
    __metadata("design:type", String)
], LoginDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Password@123',
        description: 'Contraseña del usuario',
    }),
    (0, class_validator_1.IsString)({ message: 'La contraseña debe ser un string' }),
    (0, class_validator_1.IsNotEmpty)({ message: 'La contraseña es requerida' }),
    __metadata("design:type", String)
], LoginDto.prototype, "password", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'mi-super-organizacion',
        description: 'Slug de la organización a la que se intenta acceder (opcional si se proporciona store_slug)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((o) => !o.store_slug),
    (0, class_validator_1.IsNotEmpty)({
        message: 'El slug de la organización es requerido si no se proporciona store_slug',
    }),
    __metadata("design:type", String)
], LoginDto.prototype, "organization_slug", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'mi-tienda-principal',
        description: 'Slug de la tienda a la que se intenta acceder (opcional si se proporciona organization_slug)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((o) => !o.organization_slug),
    (0, class_validator_1.IsNotEmpty)({
        message: 'El slug de la tienda es requerido si no se proporciona organization_slug',
    }),
    __metadata("design:type", String)
], LoginDto.prototype, "store_slug", void 0);
//# sourceMappingURL=login.dto.js.map