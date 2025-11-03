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
exports.SessionValidationMiddleware = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const bcrypt = require("bcrypt");
let SessionValidationMiddleware = class SessionValidationMiddleware {
    constructor(prismaService) {
        this.prismaService = prismaService;
    }
    async use(req, res, next) {
        if (req.method === 'POST' && req.path === '/auth/refresh') {
            const { refresh_token } = req.body;
            if (refresh_token) {
                try {
                    const hashedToken = await bcrypt.hash(refresh_token, 12);
                    const tokenRecord = await this.prismaService.refresh_tokens.findFirst({
                        where: {
                            token: hashedToken,
                            revoked: false,
                            expires_at: { gt: new Date() },
                        },
                    });
                    if (!tokenRecord) {
                        throw new common_1.UnauthorizedException('Refresh token inválido o revocado');
                    }
                    req.tokenRecord = tokenRecord;
                }
                catch (error) {
                    if (error instanceof common_1.UnauthorizedException) {
                        throw error;
                    }
                    console.error('Error validating refresh token:', error);
                }
            }
        }
        next();
    }
};
exports.SessionValidationMiddleware = SessionValidationMiddleware;
exports.SessionValidationMiddleware = SessionValidationMiddleware = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SessionValidationMiddleware);
//# sourceMappingURL=session-validation.middleware.js.map