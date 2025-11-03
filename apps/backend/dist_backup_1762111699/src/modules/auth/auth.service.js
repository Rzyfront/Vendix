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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const email_service_1 = require("../../email/email.service");
const bcrypt = require("bcrypt");
const audit_service_1 = require("../audit/audit.service");
let AuthService = class AuthService {
    constructor(prismaService, jwtService, emailService, configService, auditService) {
        this.prismaService = prismaService;
        this.jwtService = jwtService;
        this.emailService = emailService;
        this.configService = configService;
        this.auditService = auditService;
    }
    async registerOwner(registerOwnerDto, client_info) {
        const { email, password, first_name, last_name, organization_name } = registerOwnerDto;
        const organization_slug = this.generateSlugFromName(organization_name);
        const existingOrg = await this.prismaService.organizations.findUnique({
            where: { slug: organization_slug },
        });
        if (existingOrg) {
            throw new common_1.ConflictException('Una organización con este nombre ya existe.');
        }
        const hashedPassword = await bcrypt.hash(password, 12);
        const existingUser = await this.prismaService.users.findFirst({
            where: {
                email,
                onboarding_completed: false,
                user_roles: {
                    some: {
                        roles: {
                            name: 'owner',
                        },
                    },
                },
            },
            include: {
                user_roles: {
                    include: {
                        roles: true,
                    },
                },
            },
        });
        if (existingUser) {
            const existingOrganization = await this.prismaService.organizations.findUnique({
                where: { id: existingUser.organization_id },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    email: true,
                    state: true,
                    created_at: true,
                },
            });
            throw new common_1.ConflictException({
                message: 'Ya tienes un onboarding pendiente',
                pendingOnboarding: existingOrganization,
                user: existingUser,
            });
        }
        const result = await this.prismaService.$transaction(async (tx) => {
            const ownerRole = await tx.roles.findFirst({
                where: { name: 'owner' },
            });
            if (!ownerRole) {
                throw new common_1.BadRequestException('Rol de owner no encontrado');
            }
            const organization = await tx.organizations.create({
                data: {
                    name: organization_name,
                    slug: organization_slug,
                    email: email,
                    state: 'draft',
                },
            });
            let user;
            const wasExistingUser = false;
            const existingUserInOrg = await tx.users.findFirst({
                where: { email, organization_id: organization.id },
            });
            if (existingUserInOrg) {
                throw new common_1.ConflictException('Ya existe un usuario con este email en la organización');
            }
            const existingCustomer = await tx.users.findFirst({
                where: {
                    email,
                    user_roles: {
                        some: {
                            roles: {
                                name: 'customer',
                            },
                        },
                    },
                },
                include: {
                    user_roles: {
                        include: {
                            roles: true,
                        },
                    },
                    organizations: true,
                },
            });
            if (existingCustomer) {
                console.log(`Creando owner para email ${email} (customer existente en org: ${existingCustomer.organizations?.name})`);
            }
            user = await tx.users.create({
                data: {
                    email,
                    password: hashedPassword,
                    first_name,
                    last_name,
                    username: await this.generateUniqueUsername(email),
                    email_verified: false,
                    organization_id: organization.id,
                    onboarding_completed: false,
                },
            });
            await tx.user_settings.create({
                data: {
                    user_id: user.id,
                    config: {
                        app: 'ORG_ADMIN',
                        panel_ui: {
                            stores: true,
                            users: true,
                            dashboard: true,
                            orders: true,
                            analytics: true,
                            reports: true,
                            inventory: true,
                            billing: true,
                            ecommerce: true,
                            audit: true,
                            settings: true,
                        },
                    },
                },
            });
            const existingUserRole = await tx.user_roles.findFirst({
                where: { user_id: user.id, role_id: ownerRole.id },
            });
            if (!existingUserRole) {
                await tx.user_roles.create({
                    data: { user_id: user.id, role_id: ownerRole.id },
                });
            }
            return { organization, user, wasExistingUser };
        });
        const user = result.user;
        const userWithRoles = await this.prismaService.users.findUnique({
            where: { id: user.id },
            include: {
                user_roles: {
                    include: {
                        roles: {
                            include: {
                                role_permissions: {
                                    include: {
                                        permissions: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!userWithRoles) {
            throw new common_1.BadRequestException('Error al crear usuario owner');
        }
        await this.auditService.logCreate(userWithRoles.id, audit_service_1.AuditResource.ORGANIZATIONS, result.organization.id, {
            name: result.organization.name,
            slug: result.organization.slug,
            email: result.organization.email,
        }, {
            registration_type: result.wasExistingUser
                ? 'existing_user'
                : 'new_user',
            ip_address: client_info?.ip_address,
            user_agent: client_info?.user_agent,
        });
        await this.auditService.logCreate(userWithRoles.id, audit_service_1.AuditResource.USERS, userWithRoles.id, {
            email: userWithRoles.email,
            first_name: userWithRoles.first_name,
            last_name: userWithRoles.last_name,
            organization_id: userWithRoles.organization_id,
        }, {
            registration_type: result.wasExistingUser
                ? 'existing_user_assigned'
                : 'new_registration',
            ip_address: client_info?.ip_address,
            user_agent: client_info?.user_agent,
        });
        const tokens = await this.generateTokens(userWithRoles, {
            organization_id: result.organization.id,
            store_id: null,
        });
        await this.createUserSession(userWithRoles.id, tokens.refresh_token, {
            ip_address: client_info?.ip_address || '127.0.0.1',
            user_agent: client_info?.user_agent || 'Registration-Device',
        });
        await this.logLoginAttempt(userWithRoles.id, true);
        const verificationToken = this.generateRandomToken();
        await this.prismaService.email_verification_tokens.create({
            data: {
                user_id: userWithRoles.id,
                token: verificationToken,
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
        });
        try {
            await this.emailService.sendVerificationEmail(userWithRoles.email, verificationToken, `${userWithRoles.first_name} ${userWithRoles.last_name}`);
            console.log(`✅ Email de verificación enviado a: ${userWithRoles.email}`);
        }
        catch (error) {
            console.error('❌ Error enviando email de verificación:', error);
        }
        const { password: _, ...userWithoutPassword } = userWithRoles;
        return {
            user: userWithoutPassword,
            ...tokens,
            wasExistingUser: result.wasExistingUser,
        };
    }
    async registerCustomer(registerCustomerDto, client_info, app = 'STORE_ECOMMERCE') {
        const { email, password, first_name, last_name, store_id } = registerCustomerDto;
        const store = await this.prismaService.stores.findUnique({
            where: { id: store_id },
        });
        if (!store) {
            throw new common_1.BadRequestException('Tienda no encontrada');
        }
        const existingUser = await this.prismaService.users.findFirst({
            where: {
                email,
                organization_id: store.organization_id,
            },
        });
        if (existingUser) {
            throw new common_1.ConflictException('El usuario con este email ya existe en esta organización/tienda');
        }
        const customerRole = await this.prismaService.roles.findFirst({
            where: { name: 'customer' },
        });
        if (!customerRole) {
            throw new common_1.BadRequestException('Rol customer no encontrado');
        }
        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await this.prismaService.users.create({
            data: {
                email,
                password: hashedPassword,
                first_name,
                last_name,
                username: await this.generateUniqueUsername(email),
                email_verified: false,
                organization_id: store.organization_id,
            },
        });
        let panel_ui = {};
        if (app === 'ORG_ADMIN') {
            panel_ui = {
                stores: true,
                users: true,
                dashboard: true,
                orders: true,
                analytics: true,
                reports: true,
                inventory: true,
                billing: true,
                ecommerce: true,
                audit: true,
                settings: true,
            };
        }
        else if (app === 'STORE_ADMIN') {
            panel_ui = {
                pos: true,
                users: true,
                dashboard: true,
                analytics: true,
                reports: true,
                billing: true,
                ecommerce: true,
                settings: true,
            };
        }
        else if (app === 'STORE_ECOMMERCE') {
            panel_ui = {
                profile: true,
                history: true,
                dashboard: true,
                favorites: true,
                orders: true,
                settings: true,
            };
        }
        await this.prismaService.user_settings.create({
            data: {
                user_id: user.id,
                config: { app, panel_ui },
            },
        });
        await this.prismaService.user_roles.create({
            data: {
                user_id: user.id,
                role_id: customerRole.id,
            },
        });
        await this.prismaService.store_users.create({
            data: {
                store_id: store.id,
                user_id: user.id,
            },
        });
        const userWithRoles = await this.prismaService.users.findFirst({
            where: { id: user.id },
            include: {
                user_roles: {
                    include: {
                        roles: {
                            include: {
                                role_permissions: {
                                    include: {
                                        permissions: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!userWithRoles) {
            throw new common_1.BadRequestException('Error al crear usuario customer');
        }
        const tokens = await this.generateTokens(userWithRoles, {
            organization_id: store.organization_id,
            store_id: null,
        });
        await this.createUserSession(userWithRoles.id, tokens.refresh_token, {
            ip_address: client_info?.ip_address || '127.0.0.1',
            user_agent: client_info?.user_agent || 'Registration-Device',
        });
        await this.logLoginAttempt(userWithRoles.id, true);
        await this.auditService.logCreate(userWithRoles.id, audit_service_1.AuditResource.USERS, userWithRoles.id, {
            email: userWithRoles.email,
            first_name: userWithRoles.first_name,
            last_name: userWithRoles.last_name,
            role: 'customer',
            store_id: store.id,
            organization_id: store.organization_id,
        }, {
            store_id: store.id,
            organization_id: store.organization_id,
            registration_method: 'store_registration',
        });
        const verificationToken = this.generateRandomToken();
        await this.prismaService.email_verification_tokens.create({
            data: {
                user_id: userWithRoles.id,
                token: verificationToken,
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
        });
        try {
            await this.emailService.sendVerificationEmail(userWithRoles.email, verificationToken, `${userWithRoles.first_name} ${userWithRoles.last_name}`);
            await this.emailService.sendWelcomeEmail(userWithRoles.email, userWithRoles.first_name);
            console.log(`✅ Email de verificación y bienvenida enviado a: ${userWithRoles.email}`);
        }
        catch (error) {
            console.error('❌ Error enviando email de verificación/bienvenida:', error);
        }
        const { password: _, ...userWithoutPassword } = userWithRoles;
        return {
            user: userWithoutPassword,
            ...tokens,
        };
    }
    async registerStaff(registerStaffDto, admin_user_id, app = 'STORE_ADMIN') {
        const { email, password, first_name, last_name, role, store_id } = registerStaffDto;
        const adminUser = await this.prismaService.users.findUnique({
            where: { id: admin_user_id },
            include: {
                user_roles: {
                    include: {
                        roles: true,
                    },
                },
            },
        });
        if (!adminUser) {
            throw new common_1.NotFoundException('Usuario administrador no encontrado');
        }
        const hasPermission = adminUser.user_roles.some((ur) => ur.roles?.name === 'owner' ||
            ur.roles?.name === 'admin' ||
            ur.roles?.name === 'super_admin');
        if (!hasPermission) {
            throw new common_1.UnauthorizedException('No tienes permisos para crear usuarios staff');
        }
        const adminOrganization = await this.prismaService.organizations.findFirst({
            where: { id: adminUser.organization_id },
        });
        if (!adminOrganization) {
            throw new common_1.BadRequestException('Organización del administrador no encontrada');
        }
        const existingUser = await this.prismaService.users.findFirst({
            where: {
                email,
                organization_id: adminUser.organization_id,
            },
        });
        if (existingUser) {
            throw new common_1.ConflictException('El usuario con este email ya existe en esta organización');
        }
        const validRoles = ['manager', 'supervisor', 'employee'];
        if (!validRoles.includes(role)) {
            throw new common_1.BadRequestException(`Rol inválido. Roles válidos: ${validRoles.join(', ')}`);
        }
        const staffRole = await this.prismaService.roles.findFirst({
            where: { name: role },
        });
        if (!staffRole) {
            throw new common_1.BadRequestException(`Rol '${role}' no encontrado en la base de datos`);
        }
        if (store_id) {
            const store = await this.prismaService.stores.findFirst({
                where: {
                    id: store_id,
                    organization_id: adminUser.organization_id,
                },
            });
            if (!store) {
                throw new common_1.BadRequestException('Tienda no encontrada o no pertenece a tu organización');
            }
        }
        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await this.prismaService.users.create({
            data: {
                email,
                password: hashedPassword,
                first_name,
                last_name,
                username: await this.generateUniqueUsername(email),
                organization_id: adminUser.organization_id,
                email_verified: true,
                state: 'active',
            },
        });
        let panel_ui = {};
        if (app === 'ORG_ADMIN') {
            panel_ui = {
                stores: true,
                users: true,
                dashboard: true,
                orders: true,
                analytics: true,
                reports: true,
                inventory: true,
                billing: true,
                ecommerce: true,
                audit: true,
                settings: true,
            };
        }
        else if (app === 'STORE_ADMIN') {
            panel_ui = {
                pos: true,
                users: true,
                dashboard: true,
                analytics: true,
                reports: true,
                billing: true,
                ecommerce: true,
                settings: true,
            };
        }
        else if (app === 'STORE_ECOMMERCE') {
            panel_ui = {
                profile: true,
                history: true,
                dashboard: true,
                favorites: true,
                orders: true,
                settings: true,
            };
        }
        await this.prismaService.user_settings.create({
            data: {
                user_id: user.id,
                config: { app, panel_ui },
            },
        });
        await this.prismaService.user_roles.create({
            data: {
                user_id: user.id,
                role_id: staffRole.id,
            },
        });
        if (store_id) {
            await this.prismaService.store_users.create({
                data: {
                    store_id,
                    user_id: user.id,
                },
            });
        }
        const userWithRoles = await this.prismaService.users.findFirst({
            where: { id: user.id },
            include: {
                user_roles: {
                    include: {
                        roles: {
                            include: {
                                role_permissions: {
                                    include: {
                                        permissions: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        await this.auditService.logCreate(admin_user_id, audit_service_1.AuditResource.USERS, user.id, {
            email,
            first_name,
            last_name,
            role,
            store_id,
            created_by: admin_user_id,
        }, {
            description: `Usuario staff creado por administrador ${adminUser.email}`,
        });
        const userWithoutPassword = userWithRoles;
        return {
            message: `Usuario ${role} creado exitosamente`,
            user: userWithoutPassword,
        };
    }
    async login(loginDto, client_info) {
        const { email, password, organization_slug, store_slug } = loginDto;
        if (!organization_slug && !store_slug) {
            throw new common_1.BadRequestException('Debe proporcionar organization_slug o store_slug');
        }
        const user = await this.prismaService.users.findFirst({
            where: { email },
            include: {
                user_roles: {
                    include: {
                        roles: {
                            include: {
                                role_permissions: {
                                    include: {
                                        permissions: true,
                                    },
                                },
                            },
                        },
                    },
                },
                organizations: true,
            },
        });
        if (!user) {
            await this.logLoginAttempt(null, false, email);
            throw new common_1.UnauthorizedException('Credenciales inválidas');
        }
        if (user.state === 'suspended' || user.state === 'archived') {
            await this.logLoginAttempt(user.id, false);
            throw new common_1.UnauthorizedException('Cuenta suspendida o archivada');
        }
        let target_organization_id = null;
        let target_store_id = null;
        let login_context = '';
        if (organization_slug) {
            if (user.organization_id) {
                const userOrganization = await this.prismaService.organizations.findUnique({
                    where: { id: user.organization_id },
                });
                if (!userOrganization || userOrganization.slug !== organization_slug) {
                    await this.logLoginAttempt(user.id, false);
                    throw new common_1.UnauthorizedException('Usuario no pertenece a la organización especificada');
                }
                target_organization_id = userOrganization.id;
                login_context = `organization:${organization_slug}`;
            }
            else {
                await this.logLoginAttempt(user.id, false);
                throw new common_1.UnauthorizedException('Usuario no pertenece a ninguna organización');
            }
        }
        else if (store_slug) {
            const storeUser = await this.prismaService.store_users.findFirst({
                where: {
                    user_id: user.id,
                    store: { slug: store_slug },
                },
                include: {
                    store: {
                        include: {
                            organizations: true,
                        },
                    },
                },
            });
            if (!storeUser) {
                await this.logLoginAttempt(user.id, false);
                throw new common_1.UnauthorizedException('Usuario no tiene acceso a la tienda especificada');
            }
            target_organization_id = storeUser.store.organizations.id;
            target_store_id = storeUser.store.id;
            login_context = `store:${store_slug}`;
        }
        if (user.locked_until && new Date() < user.locked_until) {
            throw new common_1.UnauthorizedException('Cuenta temporalmente bloqueada');
        }
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            await this.auditService.logAuth(user.id, audit_service_1.AuditAction.LOGIN_FAILED, {
                email: user.email,
                reason: 'Invalid credentials',
                attempt_number: user.failed_login_attempts + 1,
            }, client_info?.ip_address || '127.0.0.1', client_info?.user_agent || 'Unknown');
            await this.handleFailedLogin(user.id, client_info);
            await this.logLoginAttempt(user.id, false);
            throw new common_1.UnauthorizedException('Credenciales inválidas');
        }
        if (user.failed_login_attempts > 0) {
            await this.prismaService.users.update({
                where: { id: user.id },
                data: {
                    failed_login_attempts: 0,
                    locked_until: null,
                },
            });
        }
        const tokens = await this.generateTokens(user, {
            organization_id: target_organization_id,
            store_id: target_store_id,
        });
        await this.createUserSession(user.id, tokens.refresh_token, {
            ip_address: client_info?.ip_address || '127.0.0.1',
            user_agent: client_info?.user_agent || 'Login-Device',
        });
        await this.logLoginAttempt(user.id, true);
        await this.auditService.logAuth(user.id, audit_service_1.AuditAction.LOGIN, {
            login_method: 'password',
            success: true,
            login_context: login_context,
            organization_id: target_organization_id,
            store_id: target_store_id,
        }, client_info?.ip_address || '127.0.0.1', client_info?.user_agent || 'Login-Device');
        await this.prismaService.users.update({
            where: { id: user.id },
            data: { last_login: new Date() },
        });
        const userSettings = await this.prismaService.user_settings.findUnique({
            where: { user_id: user.id },
        });
        const { password: _, ...userWithoutPassword } = user;
        return {
            user: userWithoutPassword,
            user_settings: userSettings,
            ...tokens,
        };
    }
    async refreshToken(refreshTokenDto, client_info) {
        const { refresh_token } = refreshTokenDto;
        try {
            const refreshSecret = this.configService.get('JWT_REFRESH_SECRET') ||
                this.configService.get('JWT_SECRET') ||
                'your-super-secret-jwt-key';
            const payload = this.jwtService.verify(refresh_token, {
                secret: refreshSecret,
            });
            const hashedRefreshToken = await bcrypt.hash(refresh_token, 12);
            const tokenRecord = await this.prismaService.refresh_tokens.findFirst({
                where: {
                    token: hashedRefreshToken,
                    expires_at: {
                        gt: new Date(),
                    },
                },
                include: {
                    users: {
                        include: {
                            user_roles: {
                                include: {
                                    roles: {
                                        include: {
                                            role_permissions: {
                                                include: {
                                                    permissions: true,
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });
            if (!tokenRecord) {
                throw new common_1.UnauthorizedException('Refresh token inválido o expirado');
            }
            await this.validateRefreshTokenSecurity(tokenRecord, client_info);
            const tokens = await this.generateTokens(tokenRecord.users, {
                organization_id: payload.organization_id,
                store_id: payload.store_id,
            });
            const userWithoutPassword = tokenRecord.users;
            const refreshTokenExpiry = this.configService.get('JWT_REFRESH_EXPIRES_IN') || '7d';
            const expiryMs = this.parseExpiryToMilliseconds(refreshTokenExpiry);
            await this.prismaService.refresh_tokens.update({
                where: { id: tokenRecord.id },
                data: {
                    token: tokens.refresh_token,
                    expires_at: new Date(Date.now() + expiryMs),
                    ip_address: client_info?.ip_address || tokenRecord.ip_address,
                    user_agent: client_info?.user_agent || tokenRecord.user_agent,
                    last_used: new Date(),
                },
            });
            return {
                user: userWithoutPassword,
                ...tokens,
            };
        }
        catch (error) {
            console.error('🚨 Intento de refresh token sospechoso:', {
                error: error.message,
                client_info,
                timestamp: new Date().toISOString(),
            });
            throw new common_1.UnauthorizedException('Token de refresco inválido');
        }
    }
    async getProfile(userId) {
        const user = await this.prismaService.users.findUnique({
            where: { id: userId },
            include: {
                user_roles: {
                    include: {
                        roles: {
                            include: {
                                role_permissions: {
                                    include: {
                                        permissions: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!user) {
            throw new common_1.UnauthorizedException('Usuario no encontrado');
        }
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    async logout(user_id, refresh_token, all_sessions = false) {
        const now = new Date();
        if (all_sessions) {
            const result = await this.prismaService.refresh_tokens.updateMany({
                where: {
                    user_id: user_id,
                    revoked: false,
                    expires_at: { gt: now },
                },
                data: {
                    revoked: true,
                    revoked_at: now,
                },
            });
            await this.auditService.logAuth(user_id, audit_service_1.AuditAction.LOGOUT, {
                action: 'logout_all_sessions',
                sessions_revoked: result.count,
            });
            return {
                message: `Se cerraron ${result.count} sesiones activas.`,
                data: { sessions_revoked: result.count },
            };
        }
        if (refresh_token) {
            const hashedRefreshToken = await bcrypt.hash(refresh_token, 12);
            try {
                const result = await this.prismaService.refresh_tokens.updateMany({
                    where: {
                        user_id: user_id,
                        token: hashedRefreshToken,
                        revoked: false,
                    },
                    data: {
                        revoked: true,
                        revoked_at: now,
                    },
                });
                if (result.count === 0) {
                    return {
                        message: 'Sesión no encontrada o ya revocada.',
                        data: { sessions_revoked: 0 },
                    };
                }
                await this.auditService.logAuth(user_id, audit_service_1.AuditAction.LOGOUT, {
                    action: 'logout_single_session',
                    sessions_revoked: result.count,
                });
                return {
                    message: 'Logout exitoso.',
                    data: { sessions_revoked: result.count },
                };
            }
            catch (error) {
                console.error('Error during logout:', error);
                throw new common_1.BadRequestException('No se pudo cerrar la sesión. Intenta de nuevo.');
            }
        }
        return {
            message: 'No se proporcionó refresh token. Use all_sessions: true para cerrar todas las sesiones.',
            data: { sessions_revoked: 0 },
        };
    }
    async sendEmailVerification(userId) {
        const user = await this.prismaService.users.findUnique({
            where: { id: userId },
        });
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        if (user.email_verified) {
            throw new common_1.BadRequestException('El email ya está verificado');
        }
        await this.prismaService.email_verification_tokens.updateMany({
            where: { user_id: userId, verified: false },
            data: { verified: true },
        });
        const token = this.generateRandomToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);
        await this.prismaService.email_verification_tokens.create({
            data: {
                user_id: userId,
                token,
                expires_at: expiresAt,
            },
        });
        await this.emailService.sendVerificationEmail(user.email, token, user.first_name);
        await this.emailService.sendWelcomeEmail(user.email, user.first_name);
    }
    async verifyEmail(token) {
        const verificationToken = await this.prismaService.email_verification_tokens.findUnique({
            where: { token },
            include: { users: true },
        });
        if (!verificationToken) {
            throw new common_1.BadRequestException('Token de verificación inválido');
        }
        if (verificationToken.verified) {
            throw new common_1.BadRequestException('Token ya utilizado');
        }
        if (new Date() > verificationToken.expires_at) {
            throw new common_1.BadRequestException('Token expirado');
        }
        await this.prismaService.email_verification_tokens.update({
            where: { id: verificationToken.id },
            data: { verified: true },
        });
        await this.prismaService.users.update({
            where: { id: verificationToken.user_id },
            data: {
                email_verified: true,
                state: 'active',
            },
        });
        return { message: 'Email verificado exitosamente' };
    }
    async resendEmailVerification(email) {
        const user = await this.prismaService.users.findFirst({
            where: { email },
        });
        if (!user) {
            return {
                message: 'Si el email existe y no está verificado, recibirás un nuevo email de verificación',
            };
        }
        if (user.email_verified) {
            throw new common_1.BadRequestException('El email ya está verificado');
        }
        await this.sendEmailVerification(user.id);
        return { message: 'Email de verificación enviado' };
    }
    async forgotPassword(email, organization_slug) {
        const organization = await this.prismaService.organizations.findUnique({
            where: { slug: organization_slug },
        });
        if (!organization) {
            return {
                message: 'Si el email y organización existen, recibirás instrucciones para restablecer tu contraseña',
            };
        }
        const user = await this.prismaService.users.findFirst({
            where: {
                email,
                organization_id: organization.id,
            },
        });
        if (!user) {
            return {
                message: 'Si el email y organización existen, recibirás instrucciones para restablecer tu contraseña',
            };
        }
        await this.prismaService.password_reset_tokens.updateMany({
            where: { user_id: user.id },
            data: { used: true },
        });
        const token = this.generateRandomToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);
        await this.prismaService.password_reset_tokens.create({
            data: {
                user_id: user.id,
                token,
                expires_at: expiresAt,
            },
        });
        await this.emailService.sendPasswordResetEmail(user.email, token, user.first_name);
        await this.auditService.logAuth(user.id, audit_service_1.AuditAction.PASSWORD_RESET, {
            method: 'forgot_password_request',
            success: true,
            email_sent: true,
        }, undefined, undefined);
        return {
            message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña',
        };
    }
    async resetPassword(token, newPassword) {
        const resetToken = await this.prismaService.password_reset_tokens.findUnique({
            where: { token },
            include: { users: true },
        });
        if (!resetToken) {
            throw new common_1.BadRequestException('Token de restablecimiento inválido');
        }
        if (resetToken.used) {
            throw new common_1.BadRequestException('Token ya utilizado');
        }
        if (new Date() > resetToken.expires_at) {
            throw new common_1.BadRequestException('Token expirado. Solicita un nuevo enlace de recuperación.');
        }
        if (!resetToken.users || resetToken.users.state !== 'active') {
            throw new common_1.BadRequestException('Usuario no encontrado o cuenta inactiva');
        }
        if (!this.validatePasswordStrength(newPassword)) {
            throw new common_1.BadRequestException('La contraseña debe tener al menos 8 caracteres, incluyendo mayúsculas, minúsculas y números');
        }
        const isSamePassword = await bcrypt.compare(newPassword, resetToken.users.password);
        if (isSamePassword) {
            throw new common_1.BadRequestException('La nueva contraseña no puede ser igual a la contraseña actual');
        }
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await this.prismaService.$transaction([
            this.prismaService.password_reset_tokens.update({
                where: { id: resetToken.id },
                data: { used: true },
            }),
            this.prismaService.users.update({
                where: { id: resetToken.user_id },
                data: {
                    password: hashedPassword,
                    failed_login_attempts: 0,
                    locked_until: null,
                },
            }),
        ]);
        await this.prismaService.refresh_tokens.deleteMany({
            where: { user_id: resetToken.user_id },
        });
        await this.auditService.logAuth(resetToken.user_id, audit_service_1.AuditAction.PASSWORD_RESET, {
            method: 'password_reset_token',
            success: true,
            token_used: true,
        }, undefined, undefined);
        return { message: 'Contraseña restablecida exitosamente' };
    }
    async changePassword(user_id, current_password, new_password) {
        const user = await this.prismaService.users.findUnique({
            where: { id: user_id },
        });
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        const isCurrentPasswordValid = await bcrypt.compare(current_password, user.password);
        if (!isCurrentPasswordValid) {
            throw new common_1.BadRequestException('Contraseña actual incorrecta');
        }
        if (!this.validatePasswordStrength(new_password)) {
            throw new common_1.BadRequestException('La contraseña debe tener al menos 8 caracteres, incluyendo mayúsculas, minúsculas y números');
        }
        const isSamePassword = await bcrypt.compare(new_password, user.password);
        if (isSamePassword) {
            throw new common_1.BadRequestException('La nueva contraseña no puede ser igual a la contraseña actual');
        }
        const hashedPassword = await bcrypt.hash(new_password, 12);
        await this.prismaService.users.update({
            where: { id: user_id },
            data: { password: hashedPassword },
        });
        await this.prismaService.refresh_tokens.deleteMany({
            where: { user_id: user_id },
        });
        await this.auditService.logAuth(user_id, audit_service_1.AuditAction.PASSWORD_CHANGE, {
            method: 'current_password_verification',
            success: true,
            sessions_invalidated: true,
        }, undefined, undefined);
        return {
            message: 'Contraseña cambiada exitosamente. Todas las sesiones han sido invalidadas por seguridad.',
        };
    }
    async verifyPasswordChangeToken(token) {
        throw new common_1.BadRequestException('Funcionalidad no implementada aún');
    }
    async verifyUserEmailAsSuperAdmin(targetUserId, superAdminId) {
        const superAdmin = await this.prismaService.users.findUnique({
            where: { id: superAdminId },
            include: {
                user_roles: {
                    include: {
                        roles: true,
                    },
                },
            },
        });
        if (!superAdmin) {
            throw new common_1.NotFoundException('Super administrador no encontrado');
        }
        const isSuperAdmin = superAdmin.user_roles.some((ur) => ur.roles?.name === 'super_admin');
        if (!isSuperAdmin) {
            throw new common_1.UnauthorizedException('No tienes permisos para realizar esta acción');
        }
        const targetUser = await this.prismaService.users.findUnique({
            where: { id: targetUserId },
        });
        if (!targetUser) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        if (targetUser.email_verified) {
            throw new common_1.BadRequestException('El email del usuario ya está verificado');
        }
        const updatedUser = await this.prismaService.users.update({
            where: { id: targetUserId },
            data: {
                email_verified: true,
                state: 'active',
                updated_at: new Date(),
            },
        });
        await this.prismaService.email_verification_tokens.updateMany({
            where: { user_id: targetUserId, verified: false },
            data: { verified: true },
        });
        await this.auditService.logUpdate(superAdminId, audit_service_1.AuditResource.USERS, targetUserId, { email_verified: false, state: targetUser.state }, { email_verified: true, state: 'active' }, {
            action: 'super_admin_email_verification',
            verified_by: superAdminId,
            verified_by_email: superAdmin.email,
        });
        const { password, ...userWithoutPassword } = updatedUser;
        return {
            message: 'Email verificado exitosamente por super administrador',
            user: userWithoutPassword,
        };
    }
    validatePasswordStrength(password) {
        const minLength = password.length >= 8;
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        return minLength && hasUpperCase && hasLowerCase && hasNumbers;
    }
    async canCreateOrganization(user_id) {
        const user = await this.prismaService.users.findUnique({
            where: { id: user_id },
            include: {
                user_roles: { include: { roles: true } },
            },
        });
        if (!user || !user.email_verified) {
            return false;
        }
        const isOwner = (user.user_roles || []).some((ur) => ur.roles?.name === 'owner');
        return !isOwner;
    }
    async getOnboardingStatus(user_id) {
        const user = await this.prismaService.users.findUnique({
            where: { id: user_id },
            include: {
                user_roles: { include: { roles: true } },
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        const email_verified = user.email_verified;
        const has_organization = !!user.organization_id;
        const can_create_organization = await this.canCreateOrganization(user_id);
        let next_step = '';
        if (!email_verified) {
            next_step = 'verify_email';
        }
        else if (!has_organization) {
            next_step = 'create_organization';
        }
        else {
            next_step = 'complete_setup';
        }
        return {
            email_verified,
            can_create_organization,
            has_organization,
            organization_id: user.organization_id,
            next_step,
        };
    }
    async startOnboarding(user_id) {
        const onboardingStatus = await this.getOnboardingStatus(user_id);
        return {
            status: 'success',
            current_step: onboardingStatus.next_step,
            message: 'Estado de onboarding obtenido',
            data: onboardingStatus,
        };
    }
    async createOrganizationDuringOnboarding(user_id, organization_data) {
        const canCreate = await this.canCreateOrganization(user_id);
        if (!canCreate) {
            throw new common_1.BadRequestException('No puedes crear una organización en este momento');
        }
        const organization = await this.prismaService.organizations.create({
            data: {
                ...organization_data,
                slug: organization_data.slug ||
                    this.generateSlugFromName(organization_data.name),
                updated_at: new Date(),
            },
        });
        const ownerRole = await this.prismaService.roles.findFirst({
            where: { name: 'owner' },
        });
        if (!ownerRole) {
            throw new common_1.BadRequestException('Rol de propietario no encontrado');
        }
        await this.prismaService.users.update({
            where: { id: user_id },
            data: { organization_id: organization.id },
        });
        const existingUserRole = await this.prismaService.user_roles.findFirst({
            where: { user_id: user_id, role_id: ownerRole.id },
        });
        if (!existingUserRole) {
            await this.prismaService.user_roles.create({
                data: { user_id: user_id, role_id: ownerRole.id },
            });
        }
        return {
            success: true,
            message: 'Organización creada exitosamente',
            organization,
            nextStep: 'setup_organization',
        };
    }
    async setupOrganization(user_id, organization_id, setup_data) {
        const user = await this.prismaService.users.findUnique({
            where: { id: user_id },
            include: { user_roles: { include: { roles: true } } },
        });
        if (!user || user.organization_id !== organization_id) {
            throw new common_1.BadRequestException('No tienes permisos para configurar esta organización');
        }
        const roleNames = user.user_roles.map((ur) => ur.roles?.name);
        if (!roleNames.includes('owner') && !roleNames.includes('admin')) {
            throw new common_1.BadRequestException('No tienes permisos para configurar esta organización');
        }
        const { address_line1, address_line2, city, state_province, postal_code, country_code, ...organization_data } = setup_data;
        const updatedOrg = await this.prismaService.organizations.update({
            where: { id: organization_id },
            data: {
                ...organization_data,
                updated_at: new Date(),
            },
        });
        if (setup_data.address_line1) {
            await this.createOrUpdateOrganizationAddress(organization_id, {
                address_line1: setup_data.address_line1,
                address_line2: setup_data.address_line2,
                city: setup_data.city,
                state_province: setup_data.state_province,
                postal_code: setup_data.postal_code,
                country_code: setup_data.country_code,
                type: 'headquarters',
                is_primary: true,
            });
        }
        return {
            success: true,
            message: 'Organización configurada exitosamente',
            nextStep: 'create_store',
        };
    }
    async createStoreDuringOnboarding(user_id, organization_id, store_data) {
        const user = await this.prismaService.users.findUnique({
            where: { id: user_id },
            include: { user_roles: { include: { roles: true } } },
        });
        if (!user || user.organization_id !== organization_id) {
            throw new common_1.BadRequestException('No tienes permisos para crear tiendas en esta organización');
        }
        const roleNames = user.user_roles.map((ur) => ur.roles?.name);
        if (!roleNames.includes('owner') && !roleNames.includes('admin')) {
            throw new common_1.BadRequestException('No tienes permisos para crear tiendas en esta organización');
        }
        const { address_line1, address_line2, city, state_province, postal_code, country_code, phone, email, currency_code, timezone, track_inventory, allow_backorders, low_stock_threshold, enable_shipping, free_shipping_threshold, enable_cod, enable_online_payments, ...storeFields } = store_data;
        try {
            const store = await this.prismaService.stores.create({
                data: {
                    ...storeFields,
                    organization_id: organization_id,
                    manager_user_id: user_id,
                    slug: store_data.slug || this.generateSlugFromName(store_data.name),
                    is_active: true,
                    updated_at: new Date(),
                },
            });
            await this.createOrUpdateStoreSettings(store.id, store_data);
            if (address_line1) {
                await this.createOrUpdateStoreAddress(store.id, {
                    address_line1,
                    address_line2,
                    city,
                    state_province,
                    postal_code,
                    country_code,
                    phone_number: phone,
                    type: 'store_physical',
                    is_primary: true,
                });
            }
            return {
                success: true,
                message: 'Tienda creada y configurada exitosamente',
                store,
                nextStep: 'complete',
            };
        }
        catch (error) {
            console.error('[ONBOARDING STORE ERROR]', error);
            throw new common_1.BadRequestException('Error al crear la tienda durante el onboarding', error.message);
        }
    }
    async setupStore(user_id, store_id, setup_data) {
        const store = await this.prismaService.stores.findUnique({
            where: { id: store_id },
        });
        if (!store) {
            throw new common_1.NotFoundException('Tienda no encontrada');
        }
        const userForStore = await this.prismaService.users.findUnique({
            where: { id: user_id },
            include: { user_roles: { include: { roles: true } } },
        });
        if (!userForStore ||
            userForStore.organization_id !== store.organization_id) {
            throw new common_1.BadRequestException('No tienes permisos para configurar esta tienda');
        }
        const roleNames = userForStore.user_roles.map((ur) => ur.roles?.name);
        if (!roleNames.includes('owner') && !roleNames.includes('admin')) {
            throw new common_1.BadRequestException('No tienes permisos para configurar esta tienda');
        }
        const { address_line1, address_line2, city, state_province, postal_code, country_code, phone, email, description, currency_code, track_inventory, allow_backorders, low_stock_threshold, enable_shipping, free_shipping_threshold, enable_cod, enable_online_payments, ...storeSettings } = setup_data;
        const validStoreFields = {
            timezone: storeSettings.timezone,
            store_type: storeSettings.store_type,
        };
        await this.prismaService.stores.update({
            where: { id: store_id },
            data: {
                ...validStoreFields,
                updated_at: new Date(),
            },
        });
        await this.createOrUpdateStoreSettings(store_id, setup_data);
        if (address_line1) {
            await this.createOrUpdateStoreAddress(store_id, {
                address_line1,
                address_line2,
                city,
                state_province,
                postal_code,
                country_code,
                phone_number: phone,
                type: 'store_physical',
                is_primary: true,
            });
        }
        return {
            success: true,
            message: 'Tienda configurada exitosamente',
            nextStep: 'complete',
        };
    }
    async completeOnboarding(user_id) {
        const onboardingStatus = await this.getOnboardingStatus(user_id);
        if (!onboardingStatus.email_verified ||
            !onboardingStatus.has_organization) {
            throw new common_1.BadRequestException('Onboarding no completado correctamente');
        }
        const validationResult = await this.validateOnboardingCompletion(user_id);
        if (!validationResult.isValid) {
            throw new common_1.BadRequestException(`Faltan datos requeridos: ${validationResult.missingFields.join(', ')}`);
        }
        const updatedUser = await this.prismaService.users.update({
            where: { id: user_id },
            data: {
                onboarding_completed: true,
                updated_at: new Date(),
            },
        });
        await this.prismaService.organizations.update({
            where: { id: updatedUser.organization_id },
            data: {
                state: 'active',
                updated_at: new Date(),
            },
        });
        await this.auditService.logUpdate(user_id, audit_service_1.AuditResource.USERS, user_id, { onboarding_completed: false }, { onboarding_completed: true }, {
            action: 'complete_onboarding',
            completed_at: new Date().toISOString(),
        });
        return {
            success: true,
            message: 'Onboarding completado exitosamente',
            data: {
                ...onboardingStatus,
                current_step: 'complete',
                onboarding_completed: true,
            },
        };
    }
    async validateOnboardingCompletion(user_id) {
        const missingFields = [];
        const user = await this.prismaService.users.findUnique({
            where: { id: user_id },
            include: {
                organizations: {
                    include: {
                        addresses: true,
                        stores: {
                            include: {
                                addresses: true,
                            },
                        },
                        domain_settings: true,
                    },
                },
            },
        });
        if (!user) {
            missingFields.push('usuario no encontrado');
            return { isValid: false, missingFields };
        }
        if (user.onboarding_completed) {
            missingFields.push('onboarding ya completado');
            return { isValid: false, missingFields };
        }
        if (!user.organizations) {
            missingFields.push('organización');
            return { isValid: false, missingFields };
        }
        const organization = user.organizations;
        if (!organization.name || !organization.description) {
            missingFields.push('nombre y descripción de organización');
        }
        if (!organization.email || !organization.phone) {
            missingFields.push('email y teléfono de organización');
        }
        if (!organization.addresses || organization.addresses.length === 0) {
            missingFields.push('dirección de organización');
        }
        else {
            const primaryAddress = organization.addresses.find((addr) => addr.is_primary);
            if (!primaryAddress ||
                !primaryAddress.address_line1 ||
                !primaryAddress.city ||
                !primaryAddress.country_code) {
                missingFields.push('dirección completa de organización');
            }
        }
        if (!organization.stores || organization.stores.length === 0) {
            missingFields.push('al menos una tienda configurada');
        }
        else {
            const store = organization.stores[0];
            if (!store.name) {
                missingFields.push('nombre de tienda');
            }
            if (!store.addresses || store.addresses.length === 0) {
                missingFields.push('dirección de tienda');
            }
        }
        if (!organization.domain_settings ||
            organization.domain_settings.length === 0) {
            missingFields.push('configuración de dominio');
        }
        else {
            const domainSetting = organization.domain_settings[0];
            if (!domainSetting.hostname) {
                missingFields.push('hostname en domain_settings');
            }
            if (!domainSetting.config) {
                missingFields.push('configuración de colores en domain_settings');
            }
            else {
                try {
                    const config = typeof domainSetting.config === 'string'
                        ? JSON.parse(domainSetting.config)
                        : domainSetting.config;
                    const colors = [];
                    if (config.branding?.primaryColor)
                        colors.push('primaryColor');
                    if (config.branding?.secondaryColor)
                        colors.push('secondaryColor');
                    if (colors.length < 2) {
                        missingFields.push('al menos 2 colores (primario y secundario) en domain_settings.config.branding');
                    }
                }
                catch (error) {
                    missingFields.push('configuración de colores válida en domain_settings');
                }
            }
        }
        return {
            isValid: missingFields.length === 0,
            missingFields,
        };
    }
    async createOrUpdateOrganizationAddress(organizationId, addressData) {
        const existingAddress = await this.prismaService.addresses.findFirst({
            where: {
                organization_id: organizationId,
                is_primary: true,
            },
        });
        if (existingAddress) {
            return await this.prismaService.addresses.update({
                where: { id: existingAddress.id },
                data: {
                    ...addressData,
                },
            });
        }
        else {
            return await this.prismaService.addresses.create({
                data: {
                    ...addressData,
                    is_primary: true,
                },
            });
        }
    }
    async createOrUpdateStoreAddress(storeId, addressData) {
        const existingAddress = await this.prismaService.addresses.findFirst({
            where: {
                store_id: storeId,
                is_primary: true,
            },
        });
        if (existingAddress) {
            return await this.prismaService.addresses.update({
                where: { id: existingAddress.id },
                data: {
                    ...addressData,
                },
            });
        }
        else {
            return await this.prismaService.addresses.create({
                data: {
                    ...addressData,
                    is_primary: true,
                },
            });
        }
    }
    async createOrUpdateStoreSettings(storeId, settingsData) {
        const existingSettings = await this.prismaService.store_settings.findFirst({
            where: { store_id: storeId },
        });
        const settingsToSave = {
            currency: settingsData.currency_code,
            timezone: settingsData.timezone,
            language: settingsData.language,
            track_inventory: settingsData.track_inventory,
            allow_backorders: settingsData.allow_backorders,
            low_stock_threshold: settingsData.low_stock_threshold,
            enable_shipping: settingsData.enable_shipping,
            free_shipping_threshold: settingsData.free_shipping_threshold,
            enable_cod: settingsData.enable_cod,
            enable_online_payments: settingsData.enable_online_payments,
        };
        if (existingSettings) {
            return await this.prismaService.store_settings.update({
                where: { id: existingSettings.id },
                data: {
                    settings: settingsToSave,
                    updated_at: new Date(),
                },
            });
        }
        else {
            return await this.prismaService.store_settings.create({
                data: {
                    store_id: storeId,
                    settings: settingsToSave,
                },
            });
        }
    }
    generateSlugFromName(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9 -]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }
    generateRandomToken() {
        return require('crypto').randomBytes(32).toString('hex');
    }
    async generateTokens(user, scope) {
        const payload = {
            sub: user.id,
            email: user.email,
            roles: user.user_roles.map((r) => r.roles.name),
            permissions: this.getPermissionsFromRoles(user.user_roles),
            organization_id: scope.organization_id,
            store_id: scope.store_id,
        };
        const accessToken = this.jwtService.sign(payload);
        const refreshToken = this.jwtService.sign(payload, {
            secret: this.configService.get('JWT_REFRESH_SECRET') ||
                this.configService.get('JWT_SECRET'),
            expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN') || '7d',
        });
        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: 'Bearer',
            expires_in: this.parseExpiryToMilliseconds(this.configService.get('JWT_EXPIRES_IN') || '1h'),
        };
    }
    async createUserSession(user_id, refresh_token, client_info) {
        const refreshTokenExpiry = this.configService.get('JWT_REFRESH_EXPIRES_IN') || '7d';
        const expiryMs = this.parseExpiryToMilliseconds(refreshTokenExpiry);
        const device_fingerprint = this.generateDeviceFingerprint(client_info);
        const hashedRefreshToken = await bcrypt.hash(refresh_token, 12);
        await this.prismaService.refresh_tokens.create({
            data: {
                user_id: user_id,
                token: hashedRefreshToken,
                expires_at: new Date(Date.now() + expiryMs),
                ip_address: client_info?.ip_address || null,
                user_agent: client_info?.user_agent || null,
                device_fingerprint: device_fingerprint,
                last_used: new Date(),
                revoked: false,
            },
        });
    }
    async handleFailedLogin(user_id, client_info) {
        const user = await this.prismaService.users.findUnique({
            where: { id: user_id },
        });
        if (!user)
            return;
        const failed_attempts = user.failed_login_attempts + 1;
        const updateData = { failed_login_attempts: failed_attempts };
        if (failed_attempts >= 5) {
            updateData.locked_until = new Date(Date.now() + 30 * 60 * 1000);
            await this.auditService.logAuth(user_id, audit_service_1.AuditAction.ACCOUNT_LOCKED, {
                reason: 'Too many failed login attempts',
                failed_attempts: failed_attempts,
                locked_until: updateData.locked_until,
            }, client_info?.ip_address || '127.0.0.1', client_info?.user_agent || 'Unknown');
        }
        await this.prismaService.users.update({
            where: { id: user_id },
            data: updateData,
        });
    }
    async logLoginAttempt(user_id, successful, email) {
        let emailToLog = email;
        if (!emailToLog && user_id) {
            const user = await this.prismaService.users.findUnique({
                where: { id: user_id },
                select: { email: true },
            });
            emailToLog = user?.email || '';
        }
        let store_id_to_log = null;
        if (user_id) {
            const su = await this.prismaService.store_users.findFirst({
                where: { user_id: user_id },
            });
            if (su)
                store_id_to_log = su.store_id;
            if (!store_id_to_log) {
                const user = await this.prismaService.users.findUnique({
                    where: { id: user_id },
                });
                if (user) {
                    const store = await this.prismaService.stores.findFirst({
                        where: { organization_id: user.organization_id },
                    });
                    if (store)
                        store_id_to_log = store.id;
                }
            }
        }
        if (!store_id_to_log) {
            store_id_to_log = null;
        }
        if (store_id_to_log) {
            await this.prismaService.login_attempts.create({
                data: {
                    email: emailToLog || '',
                    store_id: store_id_to_log,
                    success: successful,
                    ip_address: '',
                    user_agent: '',
                    failure_reason: successful ? null : 'Invalid credentials',
                },
            });
        }
    }
    async validateUser(user_id) {
        const user = await this.prismaService.users.findUnique({
            where: { id: user_id },
            include: {
                user_roles: {
                    include: {
                        roles: {
                            include: {
                                role_permissions: {
                                    include: {
                                        permissions: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!user) {
            return null;
        }
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    async getUserSessions(user_id) {
        const sessions = await this.prismaService.refresh_tokens.findMany({
            where: {
                user_id: user_id,
                revoked: false,
                expires_at: { gt: new Date() },
            },
            orderBy: { last_used: 'desc' },
            select: {
                id: true,
                device_fingerprint: true,
                ip_address: true,
                user_agent: true,
                last_used: true,
                created_at: true,
            },
        });
        return sessions.map((session) => ({
            id: session.id,
            device: this.parseDeviceInfo(session.user_agent || ''),
            ipAddress: session.ip_address,
            lastUsed: session.last_used,
            created_at: session.created_at,
            isCurrentSession: false,
        }));
    }
    async revokeUserSession(user_id, session_id) {
        const session = await this.prismaService.refresh_tokens.findFirst({
            where: {
                id: session_id,
                user_id: user_id,
                revoked: false,
            },
        });
        if (!session) {
            throw new common_1.NotFoundException('Sesión no encontrada o no pertenece al usuario');
        }
        await this.prismaService.refresh_tokens.update({
            where: { id: session_id },
            data: { revoked: true },
        });
        await this.auditService.log({
            userId: user_id,
            action: audit_service_1.AuditAction.UPDATE,
            resource: audit_service_1.AuditResource.USERS,
            resourceId: user_id,
            oldValues: { session_active: true },
            newValues: { session_active: false },
            metadata: {
                session_id: session_id,
                action: 'revoke_session',
            },
            ipAddress: session.ip_address || undefined,
            userAgent: session.user_agent || undefined,
        });
        return {
            message: 'Sesión revocada exitosamente',
            data: { session_revoked: session_id },
        };
    }
    parseExpiryToSeconds(expiry) {
        const match = expiry.match(/^(\d+)([smhd])$/);
        if (!match) {
            return 900;
        }
        const value = parseInt(match[1]);
        const unit = match[2];
        switch (unit) {
            case 's':
                return value;
            case 'm':
                return value * 60;
            case 'h':
                return value * 60 * 60;
            case 'd':
                return value * 24 * 60 * 60;
            default:
                return 900;
        }
    }
    parseExpiryToMilliseconds(expiry) {
        const match = expiry.match(/^(\d+)([smhd])$/);
        if (!match) {
            return 7 * 24 * 60 * 60 * 1000;
        }
        const value = parseInt(match[1]);
        const unit = match[2];
        switch (unit) {
            case 's':
                return value * 1000;
            case 'm':
                return value * 60 * 1000;
            case 'h':
                return value * 60 * 60 * 1000;
            case 'd':
                return value * 24 * 60 * 60 * 1000;
            default:
                return 7 * 24 * 60 * 60 * 1000;
        }
    }
    async validateRefreshTokenSecurity(tokenRecord, client_info) {
        if (!client_info) {
            console.warn('⚠️ Refresh token usado sin información del cliente');
            return;
        }
        const config = {
            strictIpCheck: this.configService.get('STRICT_IP_CHECK') || false,
            strictDeviceCheck: this.configService.get('STRICT_DEVICE_CHECK') || true,
            allowCrossDevice: this.configService.get('ALLOW_CROSS_DEVICE_REFRESH') || false,
        };
        if (tokenRecord.ip_address && client_info.ip_address) {
            if (tokenRecord.ip_address !== client_info.ip_address) {
                console.warn('🚨 IP Address mismatch:', {
                    stored: tokenRecord.ip_address,
                    current: client_info.ip_address,
                    userId: tokenRecord.user_id,
                    timestamp: new Date().toISOString(),
                });
                if (config.strictIpCheck) {
                    throw new common_1.UnauthorizedException('Token usage from different IP address detected');
                }
            }
        }
        if (tokenRecord.device_fingerprint && client_info.user_agent) {
            const current_fingerprint = this.generateDeviceFingerprint(client_info);
            if (tokenRecord.device_fingerprint !== current_fingerprint) {
                const storedBrowser = this.extractBrowserFromUserAgent(tokenRecord.user_agent || '');
                const currentBrowser = this.extractBrowserFromUserAgent(client_info.user_agent);
                const storedOS = this.extractOSFromUserAgent(tokenRecord.user_agent || '');
                const currentOS = this.extractOSFromUserAgent(client_info.user_agent);
                console.error('🚨 DEVICE FINGERPRINT MISMATCH:', {
                    userId: tokenRecord.user_id,
                    stored: {
                        fingerprint: tokenRecord.device_fingerprint,
                        browser: storedBrowser,
                        os: storedOS,
                        ip: tokenRecord.ip_address,
                    },
                    current: {
                        fingerprint: current_fingerprint,
                        browser: currentBrowser,
                        os: currentOS,
                        ip: client_info.ip_address,
                    },
                    timestamp: new Date().toISOString(),
                });
                if (config.strictDeviceCheck && !config.allowCrossDevice) {
                    await this.prismaService.refresh_tokens.update({
                        where: { id: tokenRecord.id },
                        data: {
                            revoked: true,
                            revoked_at: new Date(),
                        },
                    });
                    throw new common_1.UnauthorizedException('🛡️ Token usage from different device detected. For security, please log in again.');
                }
            }
        }
        if (tokenRecord.last_used) {
            const timeSinceLastUse = Date.now() - new Date(tokenRecord.last_used).getTime();
            const minTimeBetweenRefresh = (this.configService.get('MAX_REFRESH_FREQUENCY') || 30) * 1000;
            if (timeSinceLastUse < minTimeBetweenRefresh) {
                console.warn('🚨 Refresh token being used too frequently:', {
                    userId: tokenRecord.user_id,
                    timeSinceLastUse: Math.round(timeSinceLastUse / 1000),
                    minRequired: Math.round(minTimeBetweenRefresh / 1000),
                });
                throw new common_1.UnauthorizedException('Token refresh rate exceeded. Please wait before trying again.');
            }
        }
        if (tokenRecord.revoked) {
            throw new common_1.UnauthorizedException('Refresh token has been revoked');
        }
        console.log('✅ Refresh token validation passed:', {
            userId: tokenRecord.user_id,
            clientIP: client_info.ip_address,
            browser: this.extractBrowserFromUserAgent(client_info.user_agent || ''),
            os: this.extractOSFromUserAgent(client_info.user_agent || ''),
            device_matched: tokenRecord.device_fingerprint ===
                this.generateDeviceFingerprint(client_info),
            timestamp: new Date().toISOString(),
        });
    }
    extractBrowserFromUserAgent(userAgent) {
        if (!userAgent)
            return 'unknown';
        if (userAgent.includes('Chrome'))
            return 'Chrome';
        if (userAgent.includes('Firefox'))
            return 'Firefox';
        if (userAgent.includes('Safari') && !userAgent.includes('Chrome'))
            return 'Safari';
        if (userAgent.includes('Edge'))
            return 'Edge';
        if (userAgent.includes('Opera'))
            return 'Opera';
        return 'other';
    }
    generateDeviceFingerprint(client_info) {
        if (!client_info) {
            return 'unknown-device';
        }
        const browser = this.extractBrowserFromUserAgent(client_info.user_agent || '');
        const os = this.extractOSFromUserAgent(client_info.user_agent || '');
        const fingerprint = `${browser}-${os}-${client_info.ip_address?.split('.')[0] || 'unknown'}`;
        const crypto = require('crypto');
        return crypto
            .createHash('sha256')
            .update(fingerprint)
            .digest('hex')
            .substring(0, 32);
    }
    extractOSFromUserAgent(userAgent) {
        if (!userAgent)
            return 'unknown';
        if (userAgent.includes('Windows NT 10.0'))
            return 'Windows10';
        if (userAgent.includes('Windows NT'))
            return 'Windows';
        if (userAgent.includes('Mac OS X'))
            return 'macOS';
        if (userAgent.includes('Linux'))
            return 'Linux';
        if (userAgent.includes('Android'))
            return 'Android';
        if (userAgent.includes('iPhone') || userAgent.includes('iPad'))
            return 'iOS';
        return 'other';
    }
    async generateUniqueUsername(email) {
        const baseUsername = email.split('@')[0];
        let username = baseUsername;
        let counter = 1;
        while (await this.prismaService.users.findFirst({ where: { username } })) {
            username = `${baseUsername}${counter}`;
            counter++;
            if (counter > 100) {
                username = `${baseUsername}_${Date.now()}`;
                break;
            }
        }
        return username;
    }
    parseDeviceInfo(userAgent) {
        if (!userAgent) {
            return {
                browser: 'Unknown',
                os: 'Unknown',
                type: 'Unknown',
            };
        }
        const browser = this.extractBrowserFromUserAgent(userAgent);
        const os = this.extractOSFromUserAgent(userAgent);
        const type = this.detectDeviceType(userAgent);
        return {
            browser,
            os,
            type,
        };
    }
    detectDeviceType(userAgent) {
        if (userAgent.includes('Mobile') ||
            userAgent.includes('Android') ||
            userAgent.includes('iPhone')) {
            return 'Mobile';
        }
        if (userAgent.includes('Tablet') || userAgent.includes('iPad')) {
            return 'Tablet';
        }
        return 'Desktop';
    }
    getPermissionsFromRoles(userRoles) {
        const permissions = new Set();
        for (const userRole of userRoles) {
            if (userRole.roles?.role_permissions) {
                for (const rolePermission of userRole.roles.role_permissions) {
                    if (rolePermission.permissions?.name) {
                        permissions.add(rolePermission.permissions.name);
                    }
                }
            }
        }
        return Array.from(permissions);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        email_service_1.EmailService,
        config_1.ConfigService,
        audit_service_1.AuditService])
], AuthService);
//# sourceMappingURL=auth.service.js.map