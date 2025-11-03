"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateSalesOrderDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const create_sales_order_dto_1 = require("./create-sales-order.dto");
class UpdateSalesOrderDto extends (0, swagger_1.PartialType)(create_sales_order_dto_1.CreateSalesOrderDto) {
}
exports.UpdateSalesOrderDto = UpdateSalesOrderDto;
//# sourceMappingURL=update-sales-order.dto.js.map