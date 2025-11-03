"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JonathanModule = void 0;
const common_1 = require("@nestjs/common");
const jonathan_controller_1 = require("./jonathan.controller");
const jonathan_service_1 = require("./jonathan.service");
let JonathanModule = class JonathanModule {
};
exports.JonathanModule = JonathanModule;
exports.JonathanModule = JonathanModule = __decorate([
    (0, common_1.Module)({
        controllers: [jonathan_controller_1.JonathanController],
        providers: [jonathan_service_1.JonathanService],
    })
], JonathanModule);
//# sourceMappingURL=jonathan.module.js.map