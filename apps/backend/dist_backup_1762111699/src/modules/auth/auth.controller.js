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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_service_1 = require("./auth.service");
const login_dto_1 = require("./dto/login.dto");
const register_owner_dto_1 = require("./dto/register-owner.dto");
const register_customer_dto_1 = require("./dto/register-customer.dto");
const register_staff_dto_1 = require("./dto/register-staff.dto");
const refresh_token_dto_1 = require("./dto/refresh-token.dto");
const password_dto_1 = require("./dto/password.dto");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const public_decorator_1 = require("./decorators/public.decorator");
const roles_decorator_1 = require("./decorators/roles.decorator");
const roles_guard_1 = require("./guards/roles.guard");
const user_role_enum_1 = require("./enums/user-role.enum");
const response_service_1 = require("../../common/responses/response.service");
let AuthController = class AuthController {
    constructor(authService, responseService) {
        this.authService = authService;
        this.responseService = responseService;
    }
    async registerOwner(registerOwnerDto, request) {
        const raw_ip = request.headers['x-forwarded-for'] || request.ip || '';
        const ip_address = Array.isArray(raw_ip) ? raw_ip[0] : String(raw_ip || '');
        const user_agent = request.get('user-agent') || '';
        const client_info = {
            ip_address: ip_address || undefined,
            user_agent: user_agent || undefined,
        };
        try {
            const result = await this.authService.registerOwner(registerOwnerDto, client_info);
            if (result.wasExistingUser) {
                return this.responseService.error('Ya tienes un registro pendiente. Completa tu onboarding.', 'Existing user registration pending');
            }
            return this.responseService.success(result, 'Bienvenido a Vendix! Tu organización ha sido creada.');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al registrar el propietario', error.response?.message || error.message, error.status || 400);
        }
    }
    async registerCustomer(registerCustomerDto, request) {
        const raw_ip = request.headers['x-forwarded-for'] || request.ip || '';
        const ip_address = Array.isArray(raw_ip) ? raw_ip[0] : String(raw_ip || '');
        const user_agent = request.get('user-agent') || '';
        const client_info = {
            ip_address: ip_address || undefined,
            user_agent: user_agent || undefined,
        };
        try {
            const result = await this.authService.registerCustomer(registerCustomerDto, client_info);
            return this.responseService.success(result, 'Cliente registrado exitosamente en la tienda.');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al registrar el cliente', error.response?.message || error.message, error.status || 400);
        }
    }
    async registerStaff(registerStaffDto, user) {
        try {
            const result = await this.authService.registerStaff(registerStaffDto, user.id);
            return this.responseService.success(result.user, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al registrar el personal', error.response?.message || error.message, error.status || 400);
        }
    }
    async login(loginDto, request) {
        const raw_ip = request.headers['x-forwarded-for'] || request.ip || '';
        const ip_address = Array.isArray(raw_ip) ? raw_ip[0] : String(raw_ip || '');
        const user_agent = request.get('user-agent') || '';
        const client_info = {
            ip_address: ip_address || undefined,
            user_agent: user_agent || undefined,
        };
        try {
            const result = await this.authService.login(loginDto, client_info);
            return this.responseService.success(result, 'Login exitoso');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al iniciar sesión', error.response?.message || error.message, error.status || 400);
        }
    }
    async refreshToken(refreshTokenDto, request) {
        const raw_ip = request.headers['x-forwarded-for'] || request.ip || '';
        const ip_address = Array.isArray(raw_ip) ? raw_ip[0] : String(raw_ip || '');
        const user_agent = request.get('user-agent') || '';
        const client_info = {
            ip_address: ip_address || undefined,
            user_agent: user_agent || undefined,
        };
        try {
            const result = await this.authService.refreshToken(refreshTokenDto, client_info);
            return this.responseService.success(result, 'Token refrescado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al refrescar el token', error.response?.message || error.message, error.status || 400);
        }
    }
    async getProfile(user) {
        try {
            const profile = await this.authService.getProfile(user.id);
            return this.responseService.success(profile, 'Perfil obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el perfil', error.response?.message || error.message, error.status || 400);
        }
    }
    async logout(user, body) {
        try {
            const result = await this.authService.logout(user.id, body?.refresh_token, body?.all_sessions);
            return this.responseService.success(result.data, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al cerrar sesión', error.response?.message || error.message, error.status || 400);
        }
    }
    async getCurrentUser(user) {
        try {
            return this.responseService.success(user, 'Usuario actual obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el usuario actual', error.response?.message || error.message, error.status || 400);
        }
    }
    async verifyEmail(verifyEmailDto) {
        try {
            const result = await this.authService.verifyEmail(verifyEmailDto.token);
            return this.responseService.success(result, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al verificar el email', error.response?.message || error.message, error.status || 400);
        }
    }
    async resendVerification(resendDto) {
        try {
            const result = await this.authService.resendEmailVerification(resendDto.email);
            return this.responseService.success(result, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al reenviar la verificación', error.response?.message || error.message, error.status || 400);
        }
    }
    async forgotOwnerPassword(forgotDto) {
        try {
            const result = await this.authService.forgotPassword(forgotDto.email, forgotDto.organization_slug);
            return this.responseService.success(result, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al solicitar recuperación de contraseña', error.response?.message || error.message, error.status || 400);
        }
    }
    async resetOwnerPassword(resetDto) {
        try {
            const result = await this.authService.resetPassword(resetDto.token, resetDto.new_password);
            return this.responseService.success(result, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al restablecer la contraseña', error.response?.message || error.message, error.status || 400);
        }
    }
    async changePassword(user, changeDto) {
        try {
            const result = await this.authService.changePassword(user.id, changeDto.current_password, changeDto.new_password);
            return this.responseService.success(result, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al cambiar la contraseña', error.response?.message || error.message, error.status || 400);
        }
    }
    async getUserSessions(user) {
        try {
            const sessions = await this.authService.getUserSessions(user.id);
            return this.responseService.success(sessions, 'Sesiones obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las sesiones', error.response?.message || error.message, error.status || 400);
        }
    }
    async revokeSession(user, session_id) {
        try {
            const result = await this.authService.revokeUserSession(user.id, parseInt(session_id));
            return this.responseService.success(result.data, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al revocar la sesión', error.response?.message || error.message, error.status || 400);
        }
    }
    async getOnboardingStatus(user) {
        try {
            const userWithRoles = await this.authService.validateUser(user.id);
            const isOwner = userWithRoles?.user_roles?.some((ur) => ur.roles?.name === 'owner');
            if (!isOwner) {
                return this.responseService.error('Solo los propietarios de organización pueden acceder al estado de onboarding.', 'Access denied');
            }
            const status = await this.authService.getOnboardingStatus(user.id);
            return this.responseService.success(status, 'Estado de onboarding obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el estado de onboarding', error.response?.message || error.message, error.status || 400);
        }
    }
    async createOrganizationOnboarding(user, organizationData) {
        try {
            const userWithRoles = await this.authService.validateUser(user.id);
            const isOwner = userWithRoles?.user_roles?.some((ur) => ur.roles?.name === 'owner');
            if (!isOwner) {
                return this.responseService.error('Solo los propietarios de organización pueden crear organizaciones durante el onboarding.', 'Access denied');
            }
            const result = await this.authService.createOrganizationDuringOnboarding(user.id, organizationData);
            return this.responseService.success(result, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear la organización durante el onboarding', error.response?.message || error.message, error.status || 400);
        }
    }
    async setupOrganization(user, organization_id, setup_data) {
        try {
            const userWithRoles = await this.authService.validateUser(user.id);
            const isOwner = userWithRoles?.user_roles?.some((ur) => ur.roles?.name === 'owner');
            if (!isOwner) {
                return this.responseService.error('Solo los propietarios de organización pueden configurar organizaciones durante el onboarding.', 'Access denied');
            }
            const result = await this.authService.setupOrganization(user.id, parseInt(organization_id), setup_data);
            return this.responseService.success(result, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message ||
                'Error al configurar la organización durante el onboarding', error.response?.message || error.message, error.status || 400);
        }
    }
    async createStoreOnboarding(user, organization_id, store_data) {
        try {
            const userWithRoles = await this.authService.validateUser(user.id);
            const isOwner = userWithRoles?.user_roles?.some((ur) => ur.roles?.name === 'owner');
            if (!isOwner) {
                return this.responseService.error('Solo los propietarios de organización pueden crear tiendas durante el onboarding.', 'Access denied');
            }
            const result = await this.authService.createStoreDuringOnboarding(user.id, parseInt(organization_id), store_data);
            return this.responseService.success(result, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear la tienda durante el onboarding', error.response?.message || error.message, error.status || 400);
        }
    }
    async setupStore(user, store_id, setup_data) {
        try {
            const userWithRoles = await this.authService.validateUser(user.id);
            const isOwner = userWithRoles?.user_roles?.some((ur) => ur.roles?.name === 'owner');
            if (!isOwner) {
                return this.responseService.error('Solo los propietarios de organización pueden configurar tiendas durante el onboarding.', 'Access denied');
            }
            const result = await this.authService.setupStore(user.id, parseInt(store_id), setup_data);
            return this.responseService.success(result, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al configurar la tienda durante el onboarding', error.response?.message || error.message, error.status || 400);
        }
    }
    async completeOnboarding(user) {
        try {
            const result = await this.authService.completeOnboarding(user.id);
            return this.responseService.success(result.data, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al completar el onboarding', error.response?.message || error.message, error.status || 400);
        }
    }
    async verifyUserEmailAsSuperAdmin(userId, user) {
        try {
            const result = await this.authService.verifyUserEmailAsSuperAdmin(userId, user.id);
            return this.responseService.success(result.user, result.message);
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al verificar el email', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('register-owner'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_owner_dto_1.RegisterOwnerDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "registerOwner", null);
__decorate([
    (0, common_1.Post)('register-customer'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_customer_dto_1.RegisterCustomerDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "registerCustomer", null);
__decorate([
    (0, common_1.Post)('register-staff'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_staff_dto_1.RegisterStaffDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "registerStaff", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('refresh'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [refresh_token_dto_1.RefreshTokenDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refreshToken", null);
__decorate([
    (0, common_1.Get)('profile'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getProfile", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getCurrentUser", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('verify-email'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifyEmail", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('resend-verification'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resendVerification", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('forgot-owner-password'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [password_dto_1.ForgotPasswordDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "forgotOwnerPassword", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('reset-owner-password'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [password_dto_1.ResetPasswordDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resetOwnerPassword", null);
__decorate([
    (0, common_1.Post)('change-password'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, password_dto_1.ChangePasswordDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "changePassword", null);
__decorate([
    (0, common_1.Get)('sessions'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getUserSessions", null);
__decorate([
    (0, common_1.Delete)('sessions/:sessionId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Param)('session_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "revokeSession", null);
__decorate([
    (0, common_1.Get)('onboarding/status'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getOnboardingStatus", null);
__decorate([
    (0, common_1.Post)('onboarding/create-organization'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "createOrganizationOnboarding", null);
__decorate([
    (0, common_1.Post)('onboarding/setup-organization/:organizationId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Param)('organization_id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "setupOrganization", null);
__decorate([
    (0, common_1.Post)('onboarding/create-store/:organizationId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Param)('organization_id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "createStoreOnboarding", null);
__decorate([
    (0, common_1.Post)('onboarding/setup-store/:storeId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Param)('store_id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "setupStore", null);
__decorate([
    (0, common_1.Post)('onboarding/complete'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Completar onboarding del usuario',
        description: 'Permite a un usuario marcar su proceso de onboarding como completado. Valida que todos los datos requeridos estén configurados antes de permitir la finalización.',
    }),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Onboarding completado exitosamente',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                message: {
                    type: 'string',
                    example: 'Onboarding completado exitosamente',
                },
                data: {
                    type: 'object',
                    properties: {
                        user: {
                            type: 'object',
                            properties: {
                                id: { type: 'number', example: 1 },
                                email: { type: 'string', example: 'usuario@email.com' },
                                first_name: { type: 'string', example: 'Juan' },
                                last_name: { type: 'string', example: 'Pérez' },
                                onboarding_completed: { type: 'boolean', example: true },
                                state: { type: 'string', example: 'active' },
                            },
                        },
                        organization: {
                            type: 'object',
                            properties: {
                                id: { type: 'number', example: 1 },
                                name: { type: 'string', example: 'Mi Organización' },
                            },
                        },
                    },
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Datos faltantes o validación fallida',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    example: 'Faltan datos requeridos: nombre y descripción de organización, email y teléfono de organización, dirección de organización, al menos una tienda configurada, configuración de dominio',
                },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        description: 'Usuario no autenticado o email no verificado',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Email no verificado' },
                error: { type: 'string', example: 'Unauthorized' },
                statusCode: { type: 'number', example: 401 },
            },
        },
    }),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "completeOnboarding", null);
__decorate([
    (0, common_1.Post)('super-admin/verify-email/:userId'),
    (0, common_1.UseGuards)(roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Verificar email de usuario como Super Admin',
        description: 'Permite a un super administrador marcar el email de cualquier usuario como verificado',
    }),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Email verificado exitosamente',
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        description: 'No autorizado - se requiere rol de super admin',
    }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'Usuario no encontrado',
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'El email ya está verificado',
    }),
    __param(0, (0, common_1.Param)('userId', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifyUserEmailAsSuperAdmin", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        response_service_1.ResponseService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map