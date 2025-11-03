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
exports.SuppliersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
let SuppliersService = class SuppliersService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(createSupplierDto) {
        return this.prisma.suppliers.create({
            data: createSupplierDto,
            include: {
                addresses: true,
                supplier_products: {
                    include: {
                        products: true,
                    },
                },
            },
        });
    }
    findAll(query) {
        const where = {
            is_active: query.is_active,
            email: query.email,
            phone: query.phone,
        };
        if (query.search) {
            where.OR = [
                { name: { contains: query.search } },
                { contact_person: { contains: query.search } },
                { email: { contains: query.search } },
                { phone: { contains: query.search } },
                { mobile: { contains: query.search } },
                { website: { contains: query.search } },
                { tax_id: { contains: query.search } },
                { notes: { contains: query.search } },
            ];
        }
        return this.prisma.suppliers.findMany({
            where,
            include: {
                addresses: true,
                supplier_products: {
                    include: {
                        products: true,
                    },
                },
            },
            orderBy: {
                name: 'asc',
            },
        });
    }
    findActive(query) {
        return this.findAll({
            ...query,
            is_active: true,
        });
    }
    findOne(id) {
        return this.prisma.suppliers.findUnique({
            where: { id },
            include: {
                addresses: true,
                supplier_products: {
                    include: {
                        products: true,
                    },
                },
            },
        });
    }
    findSupplierProducts(supplierId) {
        return this.prisma.supplier_products.findMany({
            where: {
                supplier_id: supplierId,
            },
            include: {
                products: true,
                suppliers: true,
            },
            orderBy: {
                created_at: 'desc',
            },
        });
    }
    update(id, updateSupplierDto) {
        return this.prisma.suppliers.update({
            where: { id },
            data: updateSupplierDto,
            include: {
                addresses: true,
                supplier_products: {
                    include: {
                        products: true,
                    },
                },
            },
        });
    }
    remove(id) {
        return this.prisma.suppliers.update({
            where: { id },
            data: { is_active: false },
        });
    }
    async addProductToSupplier(supplierId, productId, data) {
        return this.prisma.supplier_products.create({
            data: {
                supplier_id: supplierId,
                product_id: productId,
                ...data,
            },
            include: {
                products: true,
                suppliers: true,
            },
        });
    }
    async removeProductFromSupplier(supplierId, productId) {
        return this.prisma.supplier_products.delete({
            where: {
                supplier_id_product_id: {
                    supplier_id: supplierId,
                    product_id: productId,
                },
            },
        });
    }
};
exports.SuppliersService = SuppliersService;
exports.SuppliersService = SuppliersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SuppliersService);
//# sourceMappingURL=suppliers.service.js.map