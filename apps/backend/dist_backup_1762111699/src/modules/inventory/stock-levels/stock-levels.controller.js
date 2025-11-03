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
exports.StockLevelsController = void 0;
const common_1 = require("@nestjs/common");
const stock_levels_service_1 = require("./stock-levels.service");
const stock_level_query_dto_1 = require("./dto/stock-level-query.dto");
const response_service_1 = require("../../../common/responses/response.service");
let StockLevelsController = class StockLevelsController {
    constructor(stockLevelsService, responseService) {
        this.stockLevelsService = stockLevelsService;
        this.responseService = responseService;
    }
    async findAll(query) {
        try {
            const result = await this.stockLevelsService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Niveles de stock obtenidos exitosamente');
            }
            return this.responseService.success(result, 'Niveles de stock obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los niveles de stock', error.response?.message || error.message, error.status || 400);
        }
    }
    async findByProduct(productId, query) {
        try {
            const result = await this.stockLevelsService.findByProduct(+productId, query);
            return this.responseService.success(result, 'Niveles de stock del producto obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los niveles de stock del producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async findByLocation(locationId, query) {
        try {
            const result = await this.stockLevelsService.findByLocation(+locationId, query);
            return this.responseService.success(result, 'Niveles de stock de la ubicación obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message ||
                'Error al obtener los niveles de stock de la ubicación', error.response?.message || error.message, error.status || 400);
        }
    }
    async getStockAlerts(query) {
        try {
            const result = await this.stockLevelsService.getStockAlerts(query);
            return this.responseService.success(result, 'Alertas de stock obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las alertas de stock', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id) {
        try {
            const result = await this.stockLevelsService.findOne(+id);
            return this.responseService.success(result, 'Nivel de stock obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el nivel de stock', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.StockLevelsController = StockLevelsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [stock_level_query_dto_1.StockLevelQueryDto]),
    __metadata("design:returntype", Promise)
], StockLevelsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('product/:productId'),
    __param(0, (0, common_1.Param)('productId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, stock_level_query_dto_1.StockLevelQueryDto]),
    __metadata("design:returntype", Promise)
], StockLevelsController.prototype, "findByProduct", null);
__decorate([
    (0, common_1.Get)('location/:locationId'),
    __param(0, (0, common_1.Param)('locationId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, stock_level_query_dto_1.StockLevelQueryDto]),
    __metadata("design:returntype", Promise)
], StockLevelsController.prototype, "findByLocation", null);
__decorate([
    (0, common_1.Get)('alerts'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [stock_level_query_dto_1.StockLevelQueryDto]),
    __metadata("design:returntype", Promise)
], StockLevelsController.prototype, "getStockAlerts", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StockLevelsController.prototype, "findOne", null);
exports.StockLevelsController = StockLevelsController = __decorate([
    (0, common_1.Controller)('inventory/stock-levels'),
    __metadata("design:paramtypes", [stock_levels_service_1.StockLevelsService,
        response_service_1.ResponseService])
], StockLevelsController);
//# sourceMappingURL=stock-levels.controller.js.map