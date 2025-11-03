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
exports.OrdersController = void 0;
const common_1 = require("@nestjs/common");
const orders_service_1 = require("./orders.service");
const dto_1 = require("./dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const response_service_1 = require("../../common/responses/response.service");
let OrdersController = class OrdersController {
    constructor(ordersService, responseService) {
        this.ordersService = ordersService;
        this.responseService = responseService;
    }
    async create(createOrderDto, user) {
        try {
            const result = await this.ordersService.create(createOrderDto, user);
            return this.responseService.created(result, 'Orden creada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear la orden', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query) {
        try {
            const result = await this.ordersService.findAll(query);
            if (result.data && result.pagination) {
                return this.responseService.paginated(result.data, result.pagination.total, result.pagination.page, result.pagination.limit, 'Órdenes obtenidas exitosamente');
            }
            return this.responseService.success(result, 'Órdenes obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las órdenes', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id) {
        try {
            const result = await this.ordersService.findOne(id);
            return this.responseService.success(result, 'Orden obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener la orden', error.response?.message || error.message, error.status || 400);
        }
    }
    async update(id, updateOrderDto) {
        try {
            const result = await this.ordersService.update(id, updateOrderDto);
            return this.responseService.updated(result, 'Orden actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar la orden', error.response?.message || error.message, error.status || 400);
        }
    }
    async remove(id) {
        try {
            await this.ordersService.remove(id);
            return this.responseService.deleted('Orden eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar la orden', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.OrdersController = OrdersController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.Permissions)('orders:create'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateOrderDto, Object]),
    __metadata("design:returntype", Promise)
], OrdersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('orders:read'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.OrderQueryDto]),
    __metadata("design:returntype", Promise)
], OrdersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.Permissions)('orders:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], OrdersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.Permissions)('orders:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateOrderDto]),
    __metadata("design:returntype", Promise)
], OrdersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.Permissions)('orders:delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], OrdersController.prototype, "remove", null);
exports.OrdersController = OrdersController = __decorate([
    (0, common_1.Controller)('orders'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [orders_service_1.OrdersService,
        response_service_1.ResponseService])
], OrdersController);
//# sourceMappingURL=orders.controller.js.map