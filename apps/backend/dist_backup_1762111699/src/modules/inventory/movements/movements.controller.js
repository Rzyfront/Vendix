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
exports.MovementsController = void 0;
const common_1 = require("@nestjs/common");
const movements_service_1 = require("./movements.service");
const create_movement_dto_1 = require("./dto/create-movement.dto");
const movement_query_dto_1 = require("./dto/movement-query.dto");
const response_service_1 = require("../../../common/responses/response.service");
let MovementsController = class MovementsController {
    constructor(movementsService, responseService) {
        this.movementsService = movementsService;
        this.responseService = responseService;
    }
    async create(createMovementDto) {
        try {
            const result = await this.movementsService.create(createMovementDto);
            return this.responseService.created(result, 'Movimiento de inventario creado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear el movimiento de inventario', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query) {
        try {
            const result = await this.movementsService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Movimientos de inventario obtenidos exitosamente');
            }
            return this.responseService.success(result, 'Movimientos de inventario obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los movimientos de inventario', error.response?.message || error.message, error.status || 400);
        }
    }
    async findByProduct(productId, query) {
        try {
            const result = await this.movementsService.findByProduct(+productId, query);
            return this.responseService.success(result, 'Movimientos del producto obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los movimientos del producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async findByLocation(locationId, query) {
        try {
            const result = await this.movementsService.findByLocation(+locationId, query);
            return this.responseService.success(result, 'Movimientos de la ubicación obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los movimientos de la ubicación', error.response?.message || error.message, error.status || 400);
        }
    }
    async findByUser(userId, query) {
        try {
            const result = await this.movementsService.findByUser(+userId, query);
            return this.responseService.success(result, 'Movimientos del usuario obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los movimientos del usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id) {
        try {
            const result = await this.movementsService.findOne(+id);
            return this.responseService.success(result, 'Movimiento de inventario obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el movimiento de inventario', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.MovementsController = MovementsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_movement_dto_1.CreateMovementDto]),
    __metadata("design:returntype", Promise)
], MovementsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [movement_query_dto_1.MovementQueryDto]),
    __metadata("design:returntype", Promise)
], MovementsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('product/:productId'),
    __param(0, (0, common_1.Param)('productId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, movement_query_dto_1.MovementQueryDto]),
    __metadata("design:returntype", Promise)
], MovementsController.prototype, "findByProduct", null);
__decorate([
    (0, common_1.Get)('location/:locationId'),
    __param(0, (0, common_1.Param)('locationId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, movement_query_dto_1.MovementQueryDto]),
    __metadata("design:returntype", Promise)
], MovementsController.prototype, "findByLocation", null);
__decorate([
    (0, common_1.Get)('user/:userId'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, movement_query_dto_1.MovementQueryDto]),
    __metadata("design:returntype", Promise)
], MovementsController.prototype, "findByUser", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MovementsController.prototype, "findOne", null);
exports.MovementsController = MovementsController = __decorate([
    (0, common_1.Controller)('inventory/movements'),
    __metadata("design:paramtypes", [movements_service_1.MovementsService,
        response_service_1.ResponseService])
], MovementsController);
//# sourceMappingURL=movements.controller.js.map