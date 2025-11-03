"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateTransferDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const create_transfer_dto_1 = require("./create-transfer.dto");
class UpdateTransferDto extends (0, swagger_1.PartialType)(create_transfer_dto_1.CreateTransferDto) {
}
exports.UpdateTransferDto = UpdateTransferDto;
//# sourceMappingURL=update-transfer.dto.js.map