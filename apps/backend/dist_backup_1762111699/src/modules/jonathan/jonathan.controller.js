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
Object.defineProperty(exports, "__esModule", { value: true });
exports.JonathanController = void 0;
const common_1 = require("@nestjs/common");
const jonathan_service_1 = require("./jonathan.service");
let JonathanController = class JonathanController {
    constructor(jonathanService) {
        this.jonathanService = jonathanService;
    }
    saludar() {
        return this.jonathanService.saludar();
    }
};
exports.JonathanController = JonathanController;
__decorate([
    (0, common_1.Get)('saludar'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", String)
], JonathanController.prototype, "saludar", null);
exports.JonathanController = JonathanController = __decorate([
    (0, common_1.Controller)('jonathan'),
    __metadata("design:paramtypes", [jonathan_service_1.JonathanService])
], JonathanController);
//# sourceMappingURL=jonathan.controller.js.map