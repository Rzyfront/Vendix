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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const bcrypt = require("bcryptjs");
const email_service_1 = require("../../email/email.service");
const crypto = require("crypto");
let UsersService = class UsersService {
    constructor(prisma, emailService) {
        this.prisma = prisma;
        this.emailService = emailService;
    }
    async create(createUserDto) {
        const { organization_id, email, password, app = 'VENDIX_LANDING', ...rest } = createUserDto;
        const existingUser = await this.prisma.users.findFirst({
            where: { email, organization_id },
        });
        if (existingUser) {
            throw new common_1.ConflictException('User with this email already exists in this organization');
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await this.prisma.users.create({
            data: {
                ...rest,
                email,
                password: hashedPassword,
                organizations: {
                    connect: { id: organization_id },
                },
                updated_at: new Date(),
            },
            select: {
                id: true,
                first_name: true,
                last_name: true,
                username: true,
                email: true,
                state: true,
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
        await this.prisma.user_settings.create({
            data: {
                user_id: user.id,
                config: { app, panel_ui },
            },
        });
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await this.prisma.email_verification_tokens.create({
            data: {
                user_id: user.id,
                token,
                expires_at: expiresAt,
            },
        });
        const fullName = `${user.first_name} ${user.last_name}`.trim();
        await this.emailService.sendVerificationEmail(user.email, token, fullName);
        return user;
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, state, organization_id } = query;
        const skip = (page - 1) * limit;
        const where = {
            state: { notIn: ['suspended', 'archived'] },
            ...(search && {
                OR: [
                    { first_name: { contains: search, mode: 'insensitive' } },
                    { last_name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                ],
            }),
            ...(state && { state }),
        };
        const [users, total] = await Promise.all([
            this.prisma.users.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                    username: true,
                    email: true,
                    state: true,
                    last_login: true,
                    created_at: true,
                    organizations: { select: { id: true, name: true } },
                    user_roles: {
                        include: {
                            roles: true,
                        },
                    },
                },
            }),
            this.prisma.users.count({ where }),
        ]);
        return {
            data: users,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    async findOne(id, includeSuspended = false) {
        const where = { id };
        if (!includeSuspended) {
            where.state = { notIn: ['suspended', 'archived'] };
        }
        const user = await this.prisma.users.findFirst({
            where,
            include: {
                organizations: true,
                user_roles: { include: { roles: true } },
                store_users: { include: { store: true } },
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        return user;
    }
    async update(id, updateUserDto) {
        await this.findOne(id);
        if (updateUserDto.password) {
            updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
        }
        return this.prisma.users.update({
            where: { id },
            data: { ...updateUserDto, updated_at: new Date() },
        });
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.users.update({
            where: { id },
            data: {
                state: 'suspended',
                updated_at: new Date(),
            },
        });
    }
    async archive(id) {
        await this.findOne(id);
        return this.prisma.users.update({
            where: { id },
            data: {
                state: 'archived',
                updated_at: new Date(),
            },
        });
    }
    async reactivate(id) {
        const user = await this.prisma.users.findUnique({
            where: { id },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        if (user.state !== 'suspended' && user.state !== 'archived') {
            throw new common_1.ConflictException('User is not suspended or archived');
        }
        return this.prisma.users.update({
            where: { id },
            data: {
                state: 'active',
                updated_at: new Date(),
            },
        });
    }
    async getDashboard(query) {
        const { organization_id } = query;
        const [totalUsuarios, usuariosActivos, usuariosPendientes, usuariosCon2FA, usuariosInactivos, usuariosSuspendidos, usuariosEmailVerificado, usuariosArchivados,] = await Promise.all([
            this.prisma.users.count({
                where: organization_id ? { organization_id } : {},
            }),
            this.prisma.users.count({
                where: {
                    state: 'active',
                    ...(organization_id && { organization_id }),
                },
            }),
            this.prisma.users.count({
                where: {
                    state: 'pending_verification',
                    ...(organization_id && { organization_id }),
                },
            }),
            this.prisma.users.count({
                where: {
                    two_factor_enabled: true,
                    ...(organization_id && { organization_id }),
                },
            }),
            this.prisma.users.count({
                where: {
                    state: 'inactive',
                    ...(organization_id && { organization_id }),
                },
            }),
            this.prisma.users.count({
                where: {
                    state: 'suspended',
                    ...(organization_id && { organization_id }),
                },
            }),
            this.prisma.users.count({
                where: {
                    email_verified: true,
                    ...(organization_id && { organization_id }),
                },
            }),
            this.prisma.users.count({
                where: {
                    state: 'archived',
                    ...(organization_id && { organization_id }),
                },
            }),
        ]);
        return {
            data: {
                total_usuarios: totalUsuarios,
                activos: usuariosActivos,
                pendientes: usuariosPendientes,
                con_2fa: usuariosCon2FA,
                inactivos: usuariosInactivos,
                suspendidos: usuariosSuspendidos,
                email_verificado: usuariosEmailVerificado,
                archivados: usuariosArchivados,
            },
        };
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        email_service_1.EmailService])
], UsersService);
//# sourceMappingURL=users.service.js.map