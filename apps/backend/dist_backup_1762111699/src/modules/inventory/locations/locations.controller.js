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
exports.LocationsController = void 0;
const common_1 = require("@nestjs/common");
const locations_service_1 = require("./locations.service");
const create_location_dto_1 = require("./dto/create-location.dto");
const update_location_dto_1 = require("./dto/update-location.dto");
const location_query_dto_1 = require("./dto/location-query.dto");
const request_context_decorator_1 = require("../../../common/decorators/request-context.decorator");
const response_service_1 = require("../../../common/responses/response.service");
let LocationsController = class LocationsController {
    constructor(locationsService, responseService) {
        this.locationsService = locationsService;
        this.responseService = responseService;
    }
    async create(createLocationDto, user) {
        try {
            const result = await this.locationsService.create(createLocationDto);
            return this.responseService.created(result, 'Ubicación creada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear la ubicación', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query, user) {
        try {
            const result = await this.locationsService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Ubicaciones obtenidas exitosamente');
            }
            return this.responseService.success(result, 'Ubicaciones obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las ubicaciones', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id, user) {
        try {
            const result = await this.locationsService.findOne(+id);
            return this.responseService.success(result, 'Ubicación obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener la ubicación', error.response?.message || error.message, error.status || 400);
        }
    }
    async update(id, updateLocationDto, user) {
        try {
            const result = await this.locationsService.update(+id, updateLocationDto);
            return this.responseService.updated(result, 'Ubicación actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar la ubicación', error.response?.message || error.message, error.status || 400);
        }
    }
    async remove(id, user) {
        try {
            await this.locationsService.remove(+id);
            return this.responseService.deleted('Ubicación eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar la ubicación', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.LocationsController = LocationsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_location_dto_1.CreateLocationDto, Object]),
    __metadata("design:returntype", Promise)
], LocationsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [location_query_dto_1.LocationQueryDto, Object]),
    __metadata("design:returntype", Promise)
], LocationsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], LocationsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_location_dto_1.UpdateLocationDto, Object]),
    __metadata("design:returntype", Promise)
], LocationsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], LocationsController.prototype, "remove", null);
exports.LocationsController = LocationsController = __decorate([
    (0, common_1.Controller)('inventory/locations'),
    __metadata("design:paramtypes", [locations_service_1.LocationsService,
        response_service_1.ResponseService])
], LocationsController);
//# sourceMappingURL=locations.controller.js.map