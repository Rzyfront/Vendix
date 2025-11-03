"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdatePurchaseOrderDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const create_purchase_order_dto_1 = require("./create-purchase-order.dto");
class UpdatePurchaseOrderDto extends (0, swagger_1.PartialType)(create_purchase_order_dto_1.CreatePurchaseOrderDto) {
}
exports.UpdatePurchaseOrderDto = UpdatePurchaseOrderDto;
//# sourceMappingURL=update-purchase-order.dto.js.map