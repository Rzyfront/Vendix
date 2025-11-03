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
exports.SetupStoreDto = exports.CreateStoreOnboardingDto = exports.SetupOrganizationDto = exports.CreateOrganizationOnboardingDto = exports.OnboardingStatusDto = exports.OnboardingStep = void 0;
const class_validator_1 = require("class-validator");
var OnboardingStep;
(function (OnboardingStep) {
    OnboardingStep["VERIFY_EMAIL"] = "verify_email";
    OnboardingStep["CREATE_ORGANIZATION"] = "create_organization";
    OnboardingStep["SETUP_ORGANIZATION"] = "setup_organization";
    OnboardingStep["CREATE_STORE"] = "create_store";
    OnboardingStep["SETUP_STORE"] = "setup_store";
    OnboardingStep["COMPLETE"] = "complete";
})(OnboardingStep || (exports.OnboardingStep = OnboardingStep = {}));
class OnboardingStatusDto {
}
exports.OnboardingStatusDto = OnboardingStatusDto;
class CreateOrganizationOnboardingDto {
}
exports.CreateOrganizationOnboardingDto = CreateOrganizationOnboardingDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'El nombre de la organización es requerido' }),
    (0, class_validator_1.MinLength)(2, { message: 'El nombre debe tener al menos 2 caracteres' }),
    __metadata("design:type", String)
], CreateOrganizationOnboardingDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateOrganizationOnboardingDto.prototype, "legal_name", void 0);
__decorate([
    (0, class_validator_1.IsEmail)({}, { message: 'Email de organización inválido' }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateOrganizationOnboardingDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateOrganizationOnboardingDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateOrganizationOnboardingDto.prototype, "website", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateOrganizationOnboardingDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateOrganizationOnboardingDto.prototype, "industry", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateOrganizationOnboardingDto.prototype, "tax_id", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateOrganizationOnboardingDto.prototype, "slug", void 0);
class SetupOrganizationDto {
}
exports.SetupOrganizationDto = SetupOrganizationDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "logo_url", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "banner_url", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "timezone", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "currency", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "language", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "date_format", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "address_line1", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "address_line2", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "city", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "state_province", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "postal_code", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupOrganizationDto.prototype, "country_code", void 0);
class CreateStoreOnboardingDto {
}
exports.CreateStoreOnboardingDto = CreateStoreOnboardingDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'El nombre de la tienda es requerido' }),
    (0, class_validator_1.MinLength)(2, { message: 'El nombre debe tener al menos 2 caracteres' }),
    __metadata("design:type", String)
], CreateStoreOnboardingDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateStoreOnboardingDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(['physical', 'online', 'hybrid'], {
        message: 'Tipo de tienda debe ser: physical, online o hybrid',
    }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateStoreOnboardingDto.prototype, "store_type", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateStoreOnboardingDto.prototype, "store_code", void 0);
__decorate([
    (0, class_validator_1.IsUrl)({}, { message: 'Dominio debe ser una URL válida' }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateStoreOnboardingDto.prototype, "domain", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateStoreOnboardingDto.prototype, "slug", void 0);
class SetupStoreDto {
}
exports.SetupStoreDto = SetupStoreDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "currency", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "timezone", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "language", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], SetupStoreDto.prototype, "track_inventory", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], SetupStoreDto.prototype, "allow_backorders", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], SetupStoreDto.prototype, "low_stock_threshold", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], SetupStoreDto.prototype, "enable_shipping", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], SetupStoreDto.prototype, "free_shipping_threshold", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], SetupStoreDto.prototype, "enable_cod", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], SetupStoreDto.prototype, "enable_online_payments", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "address_line1", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "address_line2", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "city", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "state_province", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "postal_code", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "country_code", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsEmail)({}, { message: 'Email de contacto inválido' }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetupStoreDto.prototype, "email", void 0);
//# sourceMappingURL=onboarding.dto.js.map