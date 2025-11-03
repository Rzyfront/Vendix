"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseInterceptor = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
let ResponseInterceptor = class ResponseInterceptor {
    intercept(context, next) {
        const response = context.switchToHttp().getResponse();
        return next.handle().pipe((0, operators_1.map)((data) => {
            if (data && typeof data === 'object') {
                if ('statusCode' in data && typeof data.statusCode === 'number') {
                    response.status(data.statusCode);
                }
                else if ('success' in data && data.success === true) {
                    const method = context.switchToHttp().getRequest().method;
                    if (method === 'POST' && response.statusCode === common_1.HttpStatus.OK) {
                        response.status(common_1.HttpStatus.CREATED);
                    }
                    else if (method === 'DELETE' && data.data === null) {
                        response.status(common_1.HttpStatus.NO_CONTENT);
                    }
                }
                else if ('success' in data && data.success === false) {
                    if (!response.statusCode || response.statusCode === common_1.HttpStatus.OK) {
                        response.status(common_1.HttpStatus.BAD_REQUEST);
                    }
                }
            }
            return data;
        }));
    }
};
exports.ResponseInterceptor = ResponseInterceptor;
exports.ResponseInterceptor = ResponseInterceptor = __decorate([
    (0, common_1.Injectable)()
], ResponseInterceptor);
//# sourceMappingURL=response.interceptor.js.map