"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const config_1 = require("@nestjs/config");
const auth_controller_1 = require("./auth.controller");
const auth_service_1 = require("./auth.service");
const jwt_strategy_1 = require("./strategies/jwt.strategy");
const prisma_module_1 = require("../../prisma/prisma.module");
const email_module_1 = require("../../email/email.module");
const organizations_module_1 = require("../organizations/organizations.module");
const audit_module_1 = require("../audit/audit.module");
const response_module_1 = require("../../common/responses/response.module");
const middleware_1 = require("../../common/middleware");
let AuthModule = class AuthModule {
    configure(consumer) {
        consumer
            .apply(middleware_1.SessionValidationMiddleware)
            .forRoutes({ path: 'auth/refresh', method: common_1.RequestMethod.POST });
        consumer
            .apply(middleware_1.LoginRateLimitMiddleware)
            .forRoutes({ path: 'auth/login', method: common_1.RequestMethod.POST });
        consumer
            .apply(middleware_1.RefreshRateLimitMiddleware)
            .forRoutes({ path: 'auth/refresh', method: common_1.RequestMethod.POST });
        consumer
            .apply(middleware_1.RateLimitMiddleware)
            .forRoutes({ path: 'auth/register-owner', method: common_1.RequestMethod.POST }, { path: 'auth/register-customer', method: common_1.RequestMethod.POST }, { path: 'auth/register-staff', method: common_1.RequestMethod.POST }, { path: 'auth/forgot-password', method: common_1.RequestMethod.POST }, { path: 'auth/reset-password', method: common_1.RequestMethod.POST });
    }
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule,
            prisma_module_1.PrismaModule,
            email_module_1.EmailModule,
            organizations_module_1.OrganizationsModule,
            audit_module_1.AuditModule,
            response_module_1.ResponseModule,
            passport_1.PassportModule.register({ defaultStrategy: 'jwt' }),
            jwt_1.JwtModule.registerAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: async (configService) => ({
                    secret: configService.get('JWT_SECRET') ||
                        'your-super-secret-jwt-key',
                    signOptions: {
                        expiresIn: configService.get('JWT_EXPIRES_IN') || '15m',
                    },
                }),
            }),
        ],
        controllers: [auth_controller_1.AuthController],
        providers: [auth_service_1.AuthService, jwt_strategy_1.JwtStrategy],
        exports: [auth_service_1.AuthService, jwt_strategy_1.JwtStrategy, passport_1.PassportModule],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map