"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryModule = void 0;
const common_1 = require("@nestjs/common");
const locations_module_1 = require("./locations/locations.module");
const stock_levels_module_1 = require("./stock-levels/stock-levels.module");
const movements_module_1 = require("./movements/movements.module");
const suppliers_module_1 = require("./suppliers/suppliers.module");
let InventoryModule = class InventoryModule {
};
exports.InventoryModule = InventoryModule;
exports.InventoryModule = InventoryModule = __decorate([
    (0, common_1.Module)({
        imports: [
            locations_module_1.LocationsModule,
            stock_levels_module_1.StockLevelsModule,
            movements_module_1.MovementsModule,
            suppliers_module_1.SuppliersModule,
        ],
        controllers: [],
        providers: [],
        exports: [
            locations_module_1.LocationsModule,
            stock_levels_module_1.StockLevelsModule,
            movements_module_1.MovementsModule,
            suppliers_module_1.SuppliersModule,
        ],
    })
], InventoryModule);
//# sourceMappingURL=inventory.module.js.map