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
exports.AddressesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const client_1 = require("@prisma/client");
let AddressesService = class AddressesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createAddressDto, user) {
        const entityTypes = [
            createAddressDto.store_id ? 'store' : null,
            createAddressDto.organization_id ? 'organization' : null,
            createAddressDto.user_id ? 'user' : null,
        ].filter(Boolean);
        if (entityTypes.length !== 1) {
            throw new common_1.BadRequestException('Debe proporcionar exactamente uno de: store_id, organization_id, o user_id');
        }
        if (createAddressDto.store_id) {
            await this.validateStoreAccess(createAddressDto.store_id, user);
        }
        else if (createAddressDto.organization_id) {
            await this.validateOrganizationAccess(createAddressDto.organization_id, user);
        }
        else if (createAddressDto.user_id) {
            await this.validateUserAccess(createAddressDto.user_id, user);
        }
        if (createAddressDto.is_primary) {
            await this.unsetOtherDefaults({
                store_id: createAddressDto.store_id,
                organization_id: createAddressDto.organization_id,
                user_id: createAddressDto.user_id,
            });
        }
        const addressData = {
            address_line1: createAddressDto.address_line_1,
            address_line2: createAddressDto.address_line_2,
            city: createAddressDto.city,
            state_province: createAddressDto.state,
            postal_code: createAddressDto.postal_code,
            country_code: createAddressDto.country,
            type: createAddressDto.type,
            is_primary: createAddressDto.is_primary,
            latitude: createAddressDto.latitude
                ? parseFloat(createAddressDto.latitude)
                : null,
            longitude: createAddressDto.longitude
                ? parseFloat(createAddressDto.longitude)
                : null,
            store_id: createAddressDto.store_id,
            organization_id: createAddressDto.organization_id,
            user_id: createAddressDto.user_id,
        };
        try {
            return await this.prisma.addresses.create({
                data: addressData,
                include: {
                    stores: { select: { id: true, name: true } },
                    organizations: { select: { id: true, name: true } },
                    users: { select: { id: true, first_name: true, last_name: true } },
                },
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2003') {
                    const field = error.meta?.field_name;
                    if (field?.includes('store_id')) {
                        throw new common_1.BadRequestException('Invalid store reference');
                    }
                    else if (field?.includes('organization_id')) {
                        throw new common_1.BadRequestException('Invalid organization reference');
                    }
                    else if (field?.includes('user_id')) {
                        throw new common_1.BadRequestException('Invalid user reference');
                    }
                }
            }
            throw error;
        }
    }
    async findAll(query, user) {
        const { page = 1, limit = 10, search, store_id, type, is_primary, city, state, country, sort_by = 'id', sort_order = 'desc', } = query;
        const skip = (page - 1) * limit;
        const where = {};
        if (search) {
            where.OR = [
                { address_line1: { contains: search, mode: 'insensitive' } },
                { address_line2: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
                { state_province: { contains: search, mode: 'insensitive' } },
                { postal_code: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (store_id) {
            where.store_id = store_id;
            await this.validateStoreAccess(store_id, user);
        }
        if (type)
            where.type = type;
        if (is_primary !== undefined)
            where.is_primary = is_primary;
        if (city)
            where.city = { contains: city, mode: 'insensitive' };
        if (state)
            where.state_province = { contains: state, mode: 'insensitive' };
        if (country)
            where.country_code = { contains: country, mode: 'insensitive' };
        const [addresses, total] = await Promise.all([
            this.prisma.addresses.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sort_by]: sort_order },
                include: {
                    stores: { select: { id: true, name: true } },
                },
            }),
            this.prisma.addresses.count({ where }),
        ]);
        return {
            data: addresses,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    async findOne(id, user) {
        const address = await this.prisma.addresses.findFirst({
            where: { id },
            include: {
                stores: { select: { id: true, name: true } },
                organizations: { select: { id: true, name: true } },
                users: { select: { id: true, first_name: true, last_name: true } },
            },
        });
        if (!address) {
            throw new common_1.NotFoundException('Address not found');
        }
        if (address.store_id) {
            await this.validateStoreAccess(address.store_id, user);
        }
        else if (address.organization_id) {
            await this.validateOrganizationAccess(address.organization_id, user);
        }
        else if (address.user_id) {
            await this.validateUserAccess(address.user_id, user);
        }
        return address;
    }
    async findByStore(storeId, user) {
        await this.validateStoreAccess(storeId, user);
        return await this.prisma.addresses.findMany({
            where: { store_id: storeId },
            include: {
                stores: { select: { id: true, name: true } },
            },
            orderBy: { is_primary: 'desc' },
        });
    }
    async update(id, updateAddressDto, user) {
        const address = await this.findOne(id, user);
        if (updateAddressDto.is_primary) {
            await this.unsetOtherDefaults({
                store_id: address.store_id || undefined,
                organization_id: address.organization_id || undefined,
                user_id: address.user_id || undefined,
            }, id);
        }
        const updateData = {};
        if (updateAddressDto.address_line_1)
            updateData.address_line1 = updateAddressDto.address_line_1;
        if (updateAddressDto.address_line_2)
            updateData.address_line2 = updateAddressDto.address_line_2;
        if (updateAddressDto.city)
            updateData.city = updateAddressDto.city;
        if (updateAddressDto.state)
            updateData.state_province = updateAddressDto.state;
        if (updateAddressDto.postal_code)
            updateData.postal_code = updateAddressDto.postal_code;
        if (updateAddressDto.country)
            updateData.country_code = updateAddressDto.country;
        if (updateAddressDto.type)
            updateData.type = updateAddressDto.type;
        if (updateAddressDto.is_primary !== undefined)
            updateData.is_primary = updateAddressDto.is_primary;
        try {
            return await this.prisma.addresses.update({
                where: { id },
                data: updateData,
                include: {
                    stores: { select: { id: true, name: true } },
                    organizations: { select: { id: true, name: true } },
                    users: { select: { id: true, first_name: true, last_name: true } },
                },
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2003') {
                    const field = error.meta?.field_name;
                    if (field?.includes('store_id')) {
                        throw new common_1.BadRequestException('Invalid store reference');
                    }
                    else if (field?.includes('organization_id')) {
                        throw new common_1.BadRequestException('Invalid organization reference');
                    }
                    else if (field?.includes('user_id')) {
                        throw new common_1.BadRequestException('Invalid user reference');
                    }
                }
            }
            throw error;
        }
    }
    async remove(id, user) {
        await this.findOne(id, user);
        const orderCount = await this.prisma.orders.count({
            where: {
                OR: [{ billing_address_id: id }, { shipping_address_id: id }],
            },
        });
        if (orderCount > 0) {
            throw new common_1.BadRequestException('Cannot delete address that is used in orders');
        }
        try {
            await this.prisma.addresses.delete({ where: { id } });
            return { message: 'Address deleted successfully' };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2003') {
                    throw new common_1.BadRequestException('Cannot delete address due to related data constraints');
                }
            }
            throw error;
        }
    }
    async validateStoreAccess(storeId, user) {
        const store = await this.prisma.stores.findUnique({
            where: { id: storeId },
        });
        if (!store) {
            throw new common_1.NotFoundException('Store not found');
        }
        if (store.organization_id !== user.organizationId &&
            user.role !== 'super_admin') {
            throw new common_1.ForbiddenException('Access denied to this store');
        }
    }
    async validateOrganizationAccess(organizationId, user) {
        const organization = await this.prisma.organizations.findUnique({
            where: { id: organizationId },
        });
        if (!organization) {
            throw new common_1.NotFoundException('Organization not found');
        }
        const userRoles = user.roles || [];
        const userOrganizationId = user.organizationId || user.organization_id;
        if (userOrganizationId !== organizationId &&
            !userRoles.includes('super_admin')) {
            throw new common_1.ForbiddenException('Access denied to this organization');
        }
    }
    async validateUserAccess(userId, currentUser) {
        if (currentUser.id !== userId && currentUser.role !== 'super_admin') {
            throw new common_1.ForbiddenException('Access denied to this user');
        }
    }
    async unsetOtherDefaults(criteria, excludeId) {
        const where = {
            is_primary: true,
        };
        if (criteria.store_id)
            where.store_id = criteria.store_id;
        if (criteria.organization_id)
            where.organization_id = criteria.organization_id;
        if (criteria.user_id)
            where.user_id = criteria.user_id;
        if (excludeId)
            where.id = { not: excludeId };
        await this.prisma.addresses.updateMany({
            where,
            data: { is_primary: false },
        });
    }
};
exports.AddressesService = AddressesService;
exports.AddressesService = AddressesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AddressesService);
//# sourceMappingURL=addresses.service.js.map