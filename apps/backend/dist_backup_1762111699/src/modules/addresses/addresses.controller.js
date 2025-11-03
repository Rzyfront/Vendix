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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddressesController = void 0;
const common_1 = require("@nestjs/common");
const addresses_service_1 = require("./addresses.service");
const dto_1 = require("./dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const response_service_1 = require("../../common/responses/response.service");
let AddressesController = class AddressesController {
    constructor(addressesService, responseService) {
        this.addressesService = addressesService;
        this.responseService = responseService;
    }
    async create(createAddressDto, user, req) {
        try {
            const result = await this.addressesService.create(createAddressDto, user);
            return this.responseService.created(result, 'Dirección creada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al crear la dirección', error.message);
        }
    }
    async findAll(query, user, req) {
        try {
            const result = await this.addressesService.findAll(query, user);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Direcciones obtenidas exitosamente');
            }
            else {
                return this.responseService.success(result, 'Direcciones obtenidas exitosamente');
            }
        }
        catch (error) {
            return this.responseService.error('Error al obtener las direcciones', error.message);
        }
    }
    async findByStore(storeId, user, req) {
        try {
            const result = await this.addressesService.findByStore(storeId, user);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Direcciones de la tienda obtenidas exitosamente');
            }
            else {
                return this.responseService.success(result, 'Direcciones de la tienda obtenidas exitosamente');
            }
        }
        catch (error) {
            return this.responseService.error('Error al obtener las direcciones', error.message);
        }
    }
    async findOne(id, user, req) {
        try {
            const result = await this.addressesService.findOne(id, user);
            return this.responseService.success(result, 'Dirección obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener la dirección', error.message);
        }
    }
    async update(id, updateAddressDto, user, req) {
        try {
            const result = await this.addressesService.update(id, updateAddressDto, user);
            return this.responseService.updated(result, 'Dirección actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al actualizar la dirección', error.message);
        }
    }
    async remove(id, user, req) {
        try {
            await this.addressesService.remove(id, user);
            return this.responseService.deleted('Dirección eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al eliminar la dirección', error.message);
        }
    }
};
exports.AddressesController = AddressesController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.Permissions)('addresses:create'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateAddressDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AddressesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('addresses:read'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.AddressQueryDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AddressesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('store/:storeId'),
    (0, permissions_decorator_1.Permissions)('addresses:read'),
    __param(0, (0, common_1.Param)('storeId', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, Object]),
    __metadata("design:returntype", Promise)
], AddressesController.prototype, "findByStore", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.Permissions)('addresses:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, Object]),
    __metadata("design:returntype", Promise)
], AddressesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.Permissions)('addresses:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, request_context_decorator_1.RequestContext)()),
    __param(3, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateAddressDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AddressesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.Permissions)('addresses:delete'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, Object]),
    __metadata("design:returntype", Promise)
], AddressesController.prototype, "remove", null);
exports.AddressesController = AddressesController = __decorate([
    (0, common_1.Controller)('addresses'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [addresses_service_1.AddressesService,
        response_service_1.ResponseService])
], AddressesController);
//# sourceMappingURL=addresses.controller.js.map