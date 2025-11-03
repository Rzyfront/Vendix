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
var DomainsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomainsService = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const prisma_service_1 = require("../../prisma/prisma.service");
const dns = require("node:dns/promises");
let DomainsService = DomainsService_1 = class DomainsService {
    constructor(prisma, eventEmitter) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.logger = new common_1.Logger(DomainsService_1.name);
        this.cache = new Map();
        this.CACHE_TTL_MS = 60000;
    }
    onModuleInit() {
        this.eventEmitter.on('domain.cache.invalidate', (payload) => {
            if (payload?.hostname) {
                if (this.cache.delete(payload.hostname)) {
                    this.logger.debug(`Cache invalidated via event for host=${payload.hostname}`);
                }
            }
        });
    }
    getFromCache(host) {
        const entry = this.cache.get(host);
        if (!entry)
            return null;
        if (Date.now() > entry.expires) {
            this.cache.delete(host);
            return null;
        }
        return entry.data;
    }
    saveInCache(host, data) {
        this.cache.set(host, { expires: Date.now() + this.CACHE_TTL_MS, data });
    }
    emitDomainCacheInvalidation(hostname) {
        try {
            this.eventEmitter.emit('domain.cache.invalidate', { hostname });
        }
        catch (e) {
            this.logger.warn(`Failed to emit domain cache invalidation: ${e}`);
        }
    }
    clearCache() {
        this.cache.clear();
        this.logger.debug('Domain resolution cache cleared manually');
    }
    clearOne(hostname) {
        this.cache.delete(hostname);
        this.logger.debug(`Domain resolution cache entry cleared manually for ${hostname}`);
    }
    async resolveDomain(hostname, subdomain, forwardedHost) {
        if (!hostname || hostname.trim() === '') {
            throw new common_1.BadRequestException('Hostname parameter is required');
        }
        let resolvedHostname = hostname.toLowerCase().trim();
        if (resolvedHostname.includes('localhost') && subdomain) {
            resolvedHostname = `${subdomain}.${resolvedHostname}`;
        }
        if (forwardedHost) {
            resolvedHostname = forwardedHost.toLowerCase().trim();
        }
        this.logger.log(`🌐 Resolving domain configuration for: ${resolvedHostname}`);
        const cached = this.getFromCache(resolvedHostname);
        if (cached) {
            this.logger.debug(`Cache hit for: ${resolvedHostname}`);
            return cached;
        }
        const domainConfig = await this.prisma.domain_settings.findUnique({
            where: { hostname: resolvedHostname },
            include: {
                organization: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                    },
                },
                store: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        organizations: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                            },
                        },
                    },
                },
            },
        });
        if (!domainConfig) {
            this.logger.warn(`⚠️ Domain config not found for: ${resolvedHostname}`);
            throw new common_1.NotFoundException(`Domain configuration not found for hostname: ${resolvedHostname}`);
        }
        let storeName;
        let store_slug;
        let organization_name;
        let organization_slug;
        if (domainConfig.store_id && domainConfig.store) {
            storeName = domainConfig.store.name;
            store_slug = domainConfig.store.slug;
            organization_name = domainConfig.store.organizations?.name;
            organization_slug = domainConfig.store.organizations?.slug;
        }
        else if (domainConfig.organization_id && domainConfig.organization) {
            organization_name = domainConfig.organization.name;
            organization_slug = domainConfig.organization.slug;
        }
        const response = {
            id: domainConfig.id,
            hostname: domainConfig.hostname,
            organization_id: domainConfig.organization_id,
            store_id: domainConfig.store_id || undefined,
            config: domainConfig.config,
            created_at: domainConfig.created_at?.toISOString() || '',
            updated_at: domainConfig.updated_at?.toISOString() || '',
            store_name: storeName,
            store_slug: store_slug,
            organization_name: organization_name,
            organization_slug: organization_slug,
            domain_type: domainConfig.domain_type,
            status: domainConfig.status,
            ssl_status: domainConfig.ssl_status,
            is_primary: domainConfig.is_primary,
            ownership: domainConfig.ownership,
        };
        this.saveInCache(resolvedHostname, response);
        this.logger.log(`✅ Successfully resolved domain: ${resolvedHostname} -> Org: ${response.organization_id}, Store: ${response.store_id}`);
        return response;
    }
    async checkHostnameAvailability(hostname) {
        this.logger.log(`🔍 Checking hostname availability: ${hostname}`);
        try {
            const exists = await this.prisma.domain_settings.findUnique({
                where: { hostname },
            });
            if (exists) {
                return {
                    available: false,
                    reason: 'Hostname already in use',
                };
            }
            return { available: true };
        }
        catch (error) {
            return { available: true };
        }
    }
    async createDomainSetting(createDomainSettingDto) {
        this.logger.log(`Creating domain setting for hostname: ${createDomainSettingDto.hostname}`);
        const data = createDomainSettingDto;
        this.validateHostnameFormat(data.hostname);
        const existingDomain = await this.prisma.domain_settings.findUnique({
            where: { hostname: data.hostname },
        });
        if (existingDomain) {
            throw new common_1.ConflictException(`Domain configuration already exists for hostname: ${data.hostname}`);
        }
        const organization = await this.prisma.organizations.findUnique({
            where: { id: data.organizationId },
        });
        if (!organization) {
            throw new common_1.NotFoundException(`Organization with ID ${data.organizationId} not found`);
        }
        if (data.storeId) {
            const store = await this.prisma.stores.findFirst({
                where: {
                    id: data.storeId,
                    organization_id: data.organizationId,
                },
            });
            if (!store) {
                throw new common_1.NotFoundException(`Store with ID ${data.storeId} not found in organization ${data.organizationId}`);
            }
        }
        const inferredType = this.inferDomainType(data.hostname, !!data.storeId, data.domainType);
        const inferredOwnership = data.ownership || this.inferOwnership(data.hostname, inferredType);
        const status = data.status || (inferredType === 'store' ? 'pending_dns' : 'active');
        const sslStatus = data.sslStatus || 'none';
        let isPrimary = data.isPrimary || false;
        if (isPrimary) {
            await this.clearExistingPrimary(data.organizationId, data.storeId, inferredType);
        }
        else {
            const existingPrimary = await this.prisma.domain_settings.findFirst({
                where: {
                    organization_id: data.organizationId,
                    store_id: data.storeId || null,
                    is_primary: true,
                    domain_type: inferredType,
                },
            });
            if (!existingPrimary) {
                isPrimary = true;
            }
        }
        const verificationToken = inferredType === 'store' ? this.generateVerificationToken() : null;
        const domainSetting = await this.prisma.domain_settings.create({
            data: {
                hostname: data.hostname,
                organization_id: data.organizationId,
                store_id: data.storeId,
                config: data.config,
                domain_type: inferredType,
                status: status,
                ssl_status: sslStatus,
                is_primary: isPrimary,
                ownership: inferredOwnership,
                verification_token: verificationToken,
            },
            include: {
                organization: { select: { id: true, name: true, slug: true } },
                store: { select: { id: true, name: true, slug: true } },
            },
        });
        this.emitDomainCacheInvalidation(domainSetting.hostname);
        this.logger.log(`Domain setting created successfully for hostname: ${data.hostname}`);
        return this.mapToResponse(domainSetting);
    }
    async getAllDomainSettings(filters) {
        const where = {};
        if (filters?.organizationId) {
            where.organization_id = filters.organizationId;
        }
        if (filters?.storeId) {
            where.store_id = filters.storeId;
        }
        if (filters?.search) {
            where.hostname = {
                contains: filters.search,
                mode: 'insensitive',
            };
        }
        const limit = Math.min(filters?.limit || 50, 100);
        const offset = filters?.offset || 0;
        const [domainSettings, total] = await Promise.all([
            this.prisma.domain_settings.findMany({
                where,
                include: {
                    organization: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                        },
                    },
                    store: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                        },
                    },
                },
                orderBy: { hostname: 'asc' },
                take: limit,
                skip: offset,
            }),
            this.prisma.domain_settings.count({ where }),
        ]);
        return {
            data: domainSettings.map((ds) => this.mapToResponse(ds)),
            total,
            limit,
            offset,
        };
    }
    async getDomainSettingByHostname(hostname) {
        this.logger.log(`Finding domain setting for hostname: ${hostname}`);
        const domainSetting = await this.prisma.domain_settings.findUnique({
            where: { hostname },
            include: {
                organization: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                    },
                },
                store: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                    },
                },
            },
        });
        if (!domainSetting) {
            throw new common_1.NotFoundException(`Domain setting not found for hostname: ${hostname}`);
        }
        return this.mapToResponse(domainSetting);
    }
    async getDomainSettingById(id) {
        this.logger.log(`Finding domain setting with ID: ${id}`);
        const domainSetting = await this.prisma.domain_settings.findUnique({
            where: { id },
            include: {
                organization: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                    },
                },
                store: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                    },
                },
            },
        });
        if (!domainSetting) {
            throw new common_1.NotFoundException(`Domain setting not found with ID: ${id}`);
        }
        return this.mapToResponse(domainSetting);
    }
    async updateDomainSetting(hostname, updateDomainSettingDto) {
        this.logger.log(`Updating domain setting for hostname: ${hostname}`);
        const data = updateDomainSettingDto;
        const existingRecord = await this.prisma.domain_settings.findUnique({
            where: { hostname },
            select: { organization_id: true, store_id: true, domain_type: true },
        });
        if (!existingRecord) {
            throw new common_1.NotFoundException(`Domain setting not found for hostname: ${hostname}`);
        }
        const updates = { updated_at: new Date() };
        if (data.config)
            updates.config = data.config;
        if (data.domainType)
            updates.domain_type = data.domainType;
        if (data.status)
            updates.status = data.status;
        if (data.sslStatus)
            updates.ssl_status = data.sslStatus;
        if (typeof data.isPrimary === 'boolean') {
            if (data.isPrimary) {
                await this.clearExistingPrimary(existingRecord.organization_id, existingRecord.store_id || undefined, existingRecord.domain_type);
            }
            updates.is_primary = data.isPrimary;
        }
        const domainSetting = await this.prisma.domain_settings.update({
            where: { hostname },
            data: updates,
            include: {
                organization: { select: { id: true, name: true, slug: true } },
                store: { select: { id: true, name: true, slug: true } },
            },
        });
        this.emitDomainCacheInvalidation(domainSetting.hostname);
        this.logger.log(`Domain setting updated successfully for hostname: ${hostname}`);
        return this.mapToResponse(domainSetting);
    }
    async deleteDomainSetting(hostname) {
        this.logger.log(`Deleting domain setting for hostname: ${hostname}`);
        await this.getDomainSettingByHostname(hostname);
        await this.prisma.domain_settings.delete({
            where: { hostname },
        });
        this.logger.log(`Domain setting deleted successfully for hostname: ${hostname}`);
        this.emitDomainCacheInvalidation(hostname);
    }
    async duplicateDomainSetting(hostname, newHostname) {
        this.logger.log(`Duplicating domain setting from ${hostname} to ${newHostname}`);
        const source = await this.getDomainSettingByHostname(hostname);
        return this.createDomainSetting({
            hostname: newHostname,
            organizationId: source.organization_id,
            storeId: source.store_id,
            config: source.config,
        });
    }
    async verifyDomain(hostname, body) {
        this.logger.log(`Starting verification for ${hostname}`);
        const domain = await this.prisma.domain_settings.findUnique({
            where: { hostname },
        });
        if (!domain)
            throw new common_1.NotFoundException(`Domain setting not found for hostname: ${hostname}`);
        const statusBefore = domain.status;
        const checksToRun = body.checks && body.checks.length > 0 ? body.checks : ['txt', 'cname'];
        const verifiableTypes = ['store', 'organization'];
        if (!verifiableTypes.includes(domain.domain_type)) {
            throw new common_1.BadRequestException(`Domain type ${domain.domain_type} is not verifiable`);
        }
        if (domain.status === 'active' && !body.force) {
            return {
                hostname,
                statusBefore,
                statusAfter: domain.status,
                sslStatus: domain.ssl_status,
                verified: true,
                nextAction: 'none',
                checks: {},
                timestamp: new Date().toISOString(),
            };
        }
        const results = {};
        const suggestedFixes = [];
        let allPassed = true;
        const expectedCname = (body.expectedCname || 'edge.vendix.com').toLowerCase();
        const expectedAList = (body.expectedA && body.expectedA.length
            ? body.expectedA
            : ['203.0.113.10']).map((i) => i.trim());
        if (checksToRun.includes('txt')) {
            try {
                const txtRecords = await dns.resolveTxt(hostname);
                const flat = txtRecords.map((arr) => arr.join('')).filter(Boolean);
                const token = domain.verification_token;
                const passed = !!token && flat.some((v) => v.includes(token));
                results.txt = { passed, found: flat, expectedToken: token };
                if (!passed) {
                    allPassed = false;
                    suggestedFixes.push(`Crear TXT con token ${token}`);
                }
            }
            catch (e) {
                results.txt = { passed: false, error: e.code || e.message };
                allPassed = false;
                suggestedFixes.push('Agregar registro TXT de verificación');
            }
        }
        if (checksToRun.includes('cname')) {
            try {
                const cnames = await dns.resolveCname(hostname);
                const normalized = cnames.map((c) => c.toLowerCase());
                const passed = normalized.includes(expectedCname);
                results.cname = { passed, found: normalized, expected: expectedCname };
                if (!passed) {
                    allPassed = false;
                    suggestedFixes.push(`Configurar CNAME -> ${expectedCname}`);
                }
            }
            catch (e) {
                results.cname = { passed: false, error: e.code || e.message };
                allPassed = false;
                suggestedFixes.push(`Agregar CNAME hacia ${expectedCname}`);
            }
        }
        if (checksToRun.includes('a')) {
            try {
                const aRecords = await dns.resolve4(hostname);
                const intersection = aRecords.filter((ip) => expectedAList.includes(ip));
                const passed = intersection.length > 0;
                results.a = { passed, found: aRecords, expectedAnyOf: expectedAList };
                if (!passed) {
                    allPassed = false;
                    suggestedFixes.push(`Apuntar A a una de: ${expectedAList.join(', ')}`);
                }
            }
            catch (e) {
                results.a = { passed: false, error: e.code || e.message };
                allPassed = false;
                suggestedFixes.push(`Agregar registro A válido (${expectedAList.join(', ')})`);
            }
        }
        if (checksToRun.includes('aaaa')) {
            try {
                const aaaaRecords = await dns.resolve6(hostname);
                results.aaaa = { passed: true, found: aaaaRecords };
            }
            catch (e) {
                results.aaaa = { passed: false, error: e.code || e.message };
            }
        }
        let statusAfter = domain.status;
        let nextAction;
        if (allPassed) {
            if (['pending_dns', 'failed_dns'].includes(domain.status)) {
                statusAfter = 'pending_ssl';
                nextAction = 'issue_certificate';
            }
        }
        else {
            if (domain.status !== 'active') {
                statusAfter = 'failed_dns';
            }
        }
        const updateData = {
            status: statusAfter,
            last_verified_at: new Date(),
            last_error: allPassed ? null : suggestedFixes[0] || 'Verification failed',
            updated_at: new Date(),
        };
        const updated = await this.prisma.domain_settings.update({
            where: { hostname },
            data: updateData,
        });
        this.emitDomainCacheInvalidation(hostname);
        return {
            hostname,
            statusBefore,
            statusAfter,
            sslStatus: updated.ssl_status,
            verified: allPassed,
            nextAction,
            checks: results,
            suggestedFixes: suggestedFixes.length ? suggestedFixes : undefined,
            timestamp: new Date().toISOString(),
            errorCode: allPassed ? undefined : 'DNS_CHECK_FAILED',
        };
    }
    async validateHostname(hostname) {
        try {
            const exists = await this.prisma.domain_settings.findUnique({
                where: { hostname },
            });
            if (exists) {
                return { valid: false, reason: 'Hostname already exists' };
            }
            return { valid: true };
        }
        catch (error) {
            if (error.message?.includes('not found')) {
                return { valid: true };
            }
            return { valid: false, reason: 'Invalid hostname format' };
        }
    }
    validateHostnameFormat(hostname) {
        return;
    }
    mapToResponse(domainSetting) {
        return {
            id: domainSetting.id,
            hostname: domainSetting.hostname,
            organization_id: domainSetting.organization_id,
            store_id: domainSetting.store_id || undefined,
            config: domainSetting.config,
            created_at: domainSetting.created_at?.toISOString() || '',
            updated_at: domainSetting.updated_at?.toISOString() || '',
            organization: domainSetting.organization,
            store: domainSetting.store,
            domain_type: domainSetting.domain_type,
            status: domainSetting.status,
            ssl_status: domainSetting.ssl_status,
            is_primary: domainSetting.is_primary,
            ownership: domainSetting.ownership,
            verification_token: domainSetting.verification_token || null,
        };
    }
    inferDomainType(hostname, hasStore, provided) {
        if (provided)
            return provided;
        if (hostname.endsWith('.vendix.com')) {
            const parts = hostname.split('.');
            if (parts.length === 3)
                return hasStore ? 'ecommerce' : 'organization';
            if (parts.length === 4)
                return 'ecommerce';
            return 'vendix_core';
        }
        return hasStore ? 'store' : 'organization';
    }
    inferOwnership(hostname, domainType) {
        if (hostname.endsWith('.vendix.com')) {
            const parts = hostname.split('.');
            if (parts.length === 2)
                return 'vendix_core';
            if (parts.length === 3)
                return 'vendix_subdomain';
            return 'vendix_subdomain';
        }
        const parts = hostname.split('.');
        if (parts.length > 2) {
            return 'custom_subdomain';
        }
        return 'custom_domain';
    }
    async clearExistingPrimary(orgId, storeId, domainType) {
        await this.prisma.domain_settings.updateMany({
            where: {
                organization_id: orgId,
                store_id: storeId || null,
                domain_type: domainType,
                is_primary: true,
            },
            data: { is_primary: false },
        });
    }
    generateVerificationToken() {
        return ('vdx_' +
            Math.random().toString(36).substring(2, 12) +
            Date.now().toString(36));
    }
    async getDomainStats() {
        this.logger.log('📊 Fetching domain statistics');
        const domains = await this.prisma.domain_settings.findMany({
            select: {
                status: true,
                ssl_status: true,
                ownership: true,
                domain_type: true,
                last_verified_at: true,
            },
        });
        const stats = {
            total: domains.length,
            active: 0,
            pending: 0,
            verified: 0,
            platformSubdomains: 0,
            customDomains: 0,
            clientSubdomains: 0,
            aliasDomains: 0,
        };
        domains.forEach((domain) => {
            if (domain.status === 'active') {
                stats.active++;
            }
            else if (domain.status === 'pending_dns' ||
                domain.status === 'pending_ssl') {
                stats.pending++;
            }
            if (domain.ssl_status === 'issued' || domain.last_verified_at) {
                stats.verified++;
            }
            switch (domain.ownership) {
                case 'vendix_subdomain':
                    stats.platformSubdomains++;
                    break;
                case 'custom_domain':
                    stats.customDomains++;
                    break;
                case 'custom_subdomain':
                    stats.clientSubdomains++;
                    break;
                case 'third_party_subdomain':
                    stats.aliasDomains++;
                    break;
                case 'vendix_core':
                    stats.platformSubdomains++;
                    break;
            }
        });
        this.logger.log(`✅ Domain stats calculated: Total=${stats.total}, Active=${stats.active}, Pending=${stats.pending}`);
        return stats;
    }
};
exports.DomainsService = DomainsService;
exports.DomainsService = DomainsService = DomainsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2])
], DomainsService);
//# sourceMappingURL=domains.service.js.map