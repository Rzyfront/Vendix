"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateLocationDto = void 0;
const mapped_types_1 = require("@nestjs/mapped-types");
const create_location_dto_1 = require("./create-location.dto");
class UpdateLocationDto extends (0, mapped_types_1.PartialType)(create_location_dto_1.CreateLocationDto) {
}
exports.UpdateLocationDto = UpdateLocationDto;
//# sourceMappingURL=update-location.dto.js.map