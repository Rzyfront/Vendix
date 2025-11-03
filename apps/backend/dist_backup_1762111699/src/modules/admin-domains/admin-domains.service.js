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
exports.AdminDomainsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let AdminDomainsService = class AdminDomainsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createDomainSettingDto) {
        const existingDomain = await this.prisma.domain_settings.findUnique({
            where: { hostname: createDomainSettingDto.hostname },
        });
        if (existingDomain) {
            throw new common_1.ConflictException('Domain with this hostname already exists');
        }
        return this.prisma.domain_settings.create({
            data: {
                hostname: createDomainSettingDto.hostname,
                organization_id: createDomainSettingDto.organizationId,
                store_id: createDomainSettingDto.storeId,
                domain_type: createDomainSettingDto.domainType,
                config: createDomainSettingDto.config,
                is_primary: createDomainSettingDto.isPrimary,
            },
            include: {
                organizations: {
                    select: { id: true, name: true, slug: true },
                },
                stores: {
                    select: { id: true, name: true, slug: true },
                },
            },
        });
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, domain_type, status, organization_id, store_id, } = query;
        const skip = (page - 1) * limit;
        const where = {};
        if (search) {
            where.OR = [{ hostname: { contains: search, mode: 'insensitive' } }];
        }
        if (domain_type) {
            where.domain_type = domain_type;
        }
        if (organization_id) {
            where.organization_id = organization_id;
        }
        if (store_id) {
            where.store_id = store_id;
        }
        const [data, total] = await Promise.all([
            this.prisma.domain_settings.findMany({
                where,
                skip,
                take: limit,
                include: {
                    organizations: {
                        select: { id: true, name: true, slug: true },
                    },
                    stores: {
                        select: { id: true, name: true, slug: true },
                    },
                },
                orderBy: { created_at: 'desc' },
            }),
            this.prisma.domain_settings.count({ where }),
        ]);
        return {
            data,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async findOne(id) {
        const domain = await this.prisma.domain_settings.findUnique({
            where: { id },
            include: {
                organizations: true,
                stores: true,
            },
        });
        if (!domain) {
            throw new common_1.NotFoundException('Domain not found');
        }
        return domain;
    }
    async update(id, updateDomainSettingDto) {
        const existingDomain = await this.prisma.domain_settings.findUnique({
            where: { id },
        });
        if (!existingDomain) {
            throw new common_1.NotFoundException('Domain not found');
        }
        return this.prisma.domain_settings.update({
            where: { id },
            data: {
                ...updateDomainSettingDto,
                domain_type: updateDomainSettingDto.domainType,
                config: updateDomainSettingDto.config,
                is_primary: updateDomainSettingDto.isPrimary,
                updated_at: new Date(),
            },
            include: {
                organizations: {
                    select: { id: true, name: true, slug: true },
                },
                stores: {
                    select: { id: true, name: true, slug: true },
                },
            },
        });
    }
    async remove(id) {
        const existingDomain = await this.prisma.domain_settings.findUnique({
            where: { id },
        });
        if (!existingDomain) {
            throw new common_1.NotFoundException('Domain not found');
        }
        if (existingDomain.is_primary) {
            throw new common_1.ConflictException('Cannot delete primary domain');
        }
        return this.prisma.domain_settings.delete({
            where: { id },
        });
    }
    async getDashboardStats() {
        const [totalDomains, activeDomains, domainsByType, domainsByOwnership, recentDomains,] = await Promise.all([
            this.prisma.domain_settings.count(),
            this.prisma.domain_settings.count({
                where: {
                    OR: [{ last_verified_at: { not: null } }, { last_error: null }],
                },
            }),
            this.prisma.domain_settings.groupBy({
                by: ['domain_type'],
                _count: true,
            }),
            this.prisma.domain_settings.groupBy({
                by: ['domain_type'],
                _count: true,
            }),
            this.prisma.domain_settings.findMany({
                take: 5,
                orderBy: { created_at: 'desc' },
                include: {
                    organizations: {
                        select: { name: true },
                    },
                    stores: {
                        select: { name: true },
                    },
                },
            }),
        ]);
        return {
            totalDomains,
            activeDomains,
            domainsByType: domainsByType.reduce((acc, item) => {
                acc[item.domain_type] = item._count;
                return acc;
            }, {}),
            domainsByOwnership: domainsByOwnership.reduce((acc, item) => {
                acc[item.domain_type] = item._count;
                return acc;
            }, {}),
            recentDomains,
        };
    }
    async verifyDomain(id) {
        const domain = await this.prisma.domain_settings.findUnique({
            where: { id },
        });
        if (!domain) {
            throw new common_1.NotFoundException('Domain not found');
        }
        return this.prisma.domain_settings.update({
            where: { id },
            data: {
                last_verified_at: new Date(),
                last_error: null,
            },
        });
    }
};
exports.AdminDomainsService = AdminDomainsService;
exports.AdminDomainsService = AdminDomainsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminDomainsService);
//# sourceMappingURL=admin-domains.service.js.map