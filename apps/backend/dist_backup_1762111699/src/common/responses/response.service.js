"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseService = void 0;
const common_1 = require("@nestjs/common");
const response_interface_1 = require("./response.interface");
let ResponseService = class ResponseService {
    success(data, message = 'Operation completed successfully', meta) {
        return {
            success: true,
            message,
            data,
            ...(meta && { meta }),
        };
    }
    error(message, error = 'An error occurred', statusCode = common_1.HttpStatus.BAD_REQUEST) {
        return {
            success: false,
            message,
            error,
            statusCode,
            timestamp: new Date().toISOString(),
        };
    }
    paginated(data, total, page, limit, message = 'Data retrieved successfully') {
        const meta = (0, response_interface_1.createPaginationMeta)(total, page, limit);
        return {
            success: true,
            message,
            data,
            meta,
        };
    }
    noContent(message = 'Operation completed successfully') {
        return {
            success: true,
            message,
            data: null,
        };
    }
    created(data, message = 'Resource created successfully') {
        return this.success(data, message);
    }
    updated(data, message = 'Resource updated successfully') {
        return this.success(data, message);
    }
    deleted(message = 'Resource deleted successfully') {
        return this.noContent(message);
    }
    notFound(message = 'Resource not found', resource) {
        return this.error(message, resource
            ? `${resource} not found`
            : 'The requested resource was not found', common_1.HttpStatus.NOT_FOUND);
    }
    unauthorized(message = 'Unauthorized') {
        return this.error(message, 'Authentication is required to access this resource', common_1.HttpStatus.UNAUTHORIZED);
    }
    forbidden(message = 'Forbidden') {
        return this.error(message, 'You do not have permission to access this resource', common_1.HttpStatus.FORBIDDEN);
    }
    conflict(message = 'Conflict', details) {
        return this.error(message, details || 'The request could not be completed due to a conflict', common_1.HttpStatus.CONFLICT);
    }
    validationError(message = 'Validation failed', validationErrors) {
        return this.error(message, validationErrors, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
    }
    internalError(message = 'Internal server error', error) {
        return this.error(message, error || 'An unexpected error occurred', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
    }
};
exports.ResponseService = ResponseService;
exports.ResponseService = ResponseService = __decorate([
    (0, common_1.Injectable)()
], ResponseService);
//# sourceMappingURL=response.service.js.map