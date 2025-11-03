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
exports.StockTransfersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
const client_1 = require("@prisma/client");
let StockTransfersService = class StockTransfersService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createTransferDto) {
        return this.prisma.$transaction(async (tx) => {
            if (createTransferDto.from_location_id === createTransferDto.to_location_id) {
                throw new common_1.BadRequestException('Source and destination locations must be different');
            }
            for (const item of createTransferDto.items) {
                const stockLevel = await tx.stock_levels.findUnique({
                    where: {
                        product_id_product_variant_id_location_id: {
                            product_id: item.product_id,
                            product_variant_id: item.product_variant_id || null,
                            location_id: createTransferDto.from_location_id,
                        },
                    },
                });
                if (!stockLevel ||
                    stockLevel.quantity_available < item.quantity_requested) {
                    throw new common_1.BadRequestException(`Insufficient stock for product ${item.product_id} at source location`);
                }
            }
            const transferNumber = await this.generateTransferNumber(tx);
            const stockTransfer = await tx.stock_transfers.create({
                data: {
                    ...createTransferDto,
                    transfer_number: transferNumber,
                    transfer_date: new Date(),
                    expected_completion_date: createTransferDto.expected_completion_date,
                },
                include: {
                    from_location: true,
                    to_location: true,
                    stock_transfer_items: {
                        include: {
                            products: true,
                            product_variants: true,
                        },
                    },
                },
            });
            return stockTransfer;
        });
    }
    findAll(query) {
        const where = {
            from_location_id: query.from_location_id,
            to_location_id: query.to_location_id,
            status: query.status,
        };
        if (query.transfer_date_from || query.transfer_date_to) {
            where.transfer_date = {};
            if (query.transfer_date_from) {
                where.transfer_date.gte = query.transfer_date_from;
            }
            if (query.transfer_date_to) {
                where.transfer_date.lte = query.transfer_date_to;
            }
        }
        if (query.search) {
            where.OR = [
                { transfer_number: { contains: query.search } },
                { reference_number: { contains: query.search } },
                { reason: { contains: query.search } },
                { notes: { contains: query.search } },
            ];
        }
        if (query.product_id) {
            where.stock_transfer_items = {
                some: {
                    product_id: query.product_id,
                },
            };
        }
        return this.prisma.stock_transfers.findMany({
            where,
            include: {
                from_location: true,
                to_location: true,
                stock_transfer_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
            orderBy: {
                transfer_date: 'desc',
            },
        });
    }
    findByStatus(status, query) {
        return this.findAll({
            ...query,
            status,
        });
    }
    findByFromLocation(locationId, query) {
        return this.findAll({
            ...query,
            from_location_id: locationId,
        });
    }
    findByToLocation(locationId, query) {
        return this.findAll({
            ...query,
            to_location_id: locationId,
        });
    }
    findOne(id) {
        return this.prisma.stock_transfers.findUnique({
            where: { id },
            include: {
                from_location: true,
                to_location: true,
                stock_transfer_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
        });
    }
    async update(id, updateTransferDto) {
        const existingTransfer = await this.prisma.stock_transfers.findUnique({
            where: { id },
        });
        if (existingTransfer.status !== client_1.transfer_status_enum.draft) {
            throw new common_1.BadRequestException('Only draft transfers can be updated');
        }
        return this.prisma.stock_transfers.update({
            where: { id },
            data: updateTransferDto,
            include: {
                from_location: true,
                to_location: true,
                stock_transfer_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
        });
    }
    async approve(id) {
        return this.prisma.$transaction(async (tx) => {
            const stockTransfer = await tx.stock_transfers.findUnique({
                where: { id },
                include: { stock_transfer_items: true },
            });
            if (stockTransfer.status !== client_1.transfer_status_enum.draft) {
                throw new common_1.BadRequestException('Only draft transfers can be approved');
            }
            for (const item of stockTransfer.stock_transfer_items) {
                await this.reserveStock(tx, item.product_id, stockTransfer.from_location_id, item.quantity, item.product_variant_id);
            }
            return tx.stock_transfers.update({
                where: { id },
                data: {
                    status: client_1.transfer_status_enum.in_transit,
                    approved_date: new Date(),
                },
                include: {
                    from_location: true,
                    to_location: true,
                    stock_transfer_items: {
                        include: {
                            products: true,
                            product_variants: true,
                        },
                    },
                },
            });
        });
    }
    async startTransfer(id) {
        const stockTransfer = await this.prisma.stock_transfers.findUnique({
            where: { id },
        });
        if (stockTransfer.status !== client_1.transfer_status_enum.in_transit) {
            throw new common_1.BadRequestException('Only in-transit transfers can be started');
        }
        return this.prisma.stock_transfers.update({
            where: { id },
            data: {
                started_date: new Date(),
            },
            include: {
                from_location: true,
                to_location: true,
                stock_transfer_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
        });
    }
    async complete(id, items) {
        return this.prisma.$transaction(async (tx) => {
            for (const item of items) {
                await tx.stock_transfer_items.update({
                    where: { id: item.id },
                    data: {
                        quantity_received: item.quantity_received,
                        received_date: new Date(),
                    },
                });
            }
            const stockTransfer = await tx.stock_transfers.findUnique({
                where: { id },
                include: {
                    stock_transfer_items: true,
                },
            });
            for (const item of stockTransfer.stock_transfer_items) {
                const receivedItem = items.find((i) => i.id === item.id);
                if (receivedItem && receivedItem.quantity_received > 0) {
                    await tx.inventory_movements.create({
                        data: {
                            organization_id: stockTransfer.organization_id,
                            product_id: item.product_id,
                            product_variant_id: item.product_variant_id,
                            from_location_id: stockTransfer.from_location_id,
                            quantity: receivedItem.quantity_received,
                            movement_type: 'transfer',
                            source_order_type: 'stock_transfer',
                            source_order_id: id,
                            reason: 'Stock transfer - source',
                            created_at: new Date(),
                        },
                    });
                    await tx.inventory_movements.create({
                        data: {
                            organization_id: stockTransfer.organization_id,
                            product_id: item.product_id,
                            product_variant_id: item.product_variant_id,
                            to_location_id: stockTransfer.to_location_id,
                            quantity: receivedItem.quantity_received,
                            movement_type: 'transfer',
                            source_order_type: 'stock_transfer',
                            source_order_id: id,
                            reason: 'Stock transfer - destination',
                            created_at: new Date(),
                        },
                    });
                    await this.updateStockLevel(tx, item.product_id, stockTransfer.from_location_id, -receivedItem.quantity_received, item.product_variant_id);
                    await this.updateStockLevel(tx, item.product_id, stockTransfer.to_location_id, receivedItem.quantity_received, item.product_variant_id);
                    await this.releaseStock(tx, item.product_id, stockTransfer.from_location_id, receivedItem.quantity_received, item.product_variant_id);
                }
            }
            const allItemsReceived = stockTransfer.stock_transfer_items.every((item) => {
                const receivedItem = items.find((i) => i.id === item.id);
                return (receivedItem && receivedItem.quantity_received >= item.quantity);
            });
            const newStatus = allItemsReceived
                ? client_1.transfer_status_enum.completed
                : client_1.transfer_status_enum.in_transit;
            return tx.stock_transfers.update({
                where: { id },
                data: {
                    status: newStatus,
                    completed_date: allItemsReceived ? new Date() : null,
                },
                include: {
                    from_location: true,
                    to_location: true,
                    stock_transfer_items: {
                        include: {
                            products: true,
                            product_variants: true,
                        },
                    },
                },
            });
        });
    }
    async cancel(id) {
        return this.prisma.$transaction(async (tx) => {
            const stockTransfer = await tx.stock_transfers.findUnique({
                where: { id },
                include: { stock_transfer_items: true },
            });
            if (stockTransfer.status === client_1.transfer_status_enum.completed) {
                throw new common_1.BadRequestException('Completed transfers cannot be cancelled');
            }
            if (stockTransfer.status === client_1.transfer_status_enum.in_transit) {
                for (const item of stockTransfer.stock_transfer_items) {
                    await this.releaseStock(tx, item.product_id, stockTransfer.from_location_id, item.quantity, item.product_variant_id);
                }
            }
            return tx.stock_transfers.update({
                where: { id },
                data: {
                    status: client_1.transfer_status_enum.cancelled,
                    cancelled_date: new Date(),
                },
                include: {
                    from_location: true,
                    to_location: true,
                    stock_transfer_items: {
                        include: {
                            products: true,
                            product_variants: true,
                        },
                    },
                },
            });
        });
    }
    remove(id) {
        return this.prisma.stock_transfers.delete({
            where: { id },
        });
    }
    async generateTransferNumber(tx) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const prefix = `TRF-${year}${month}${day}`;
        const lastTransfer = await tx.stock_transfers.findFirst({
            where: {
                transfer_number: {
                    startsWith: prefix,
                },
            },
            orderBy: {
                transfer_number: 'desc',
            },
        });
        let sequence = 1;
        if (lastTransfer) {
            const lastSequence = parseInt(lastTransfer.transfer_number.split('-')[2]);
            sequence = lastSequence + 1;
        }
        return `${prefix}-${String(sequence).padStart(4, '0')}`;
    }
    async reserveStock(tx, productId, locationId, quantity, productVariantId) {
        const existingStock = await tx.stock_levels.findUnique({
            where: {
                product_id_product_variant_id_location_id: {
                    product_id: productId,
                    product_variant_id: productVariantId || null,
                    location_id: locationId,
                },
            },
        });
        if (existingStock) {
            const newQuantityReserved = existingStock.quantity_reserved + quantity;
            const newQuantityAvailable = existingStock.quantity_available - quantity;
            return tx.stock_levels.update({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: locationId,
                    },
                },
                data: {
                    quantity_reserved: Math.max(0, newQuantityReserved),
                    quantity_available: Math.max(0, newQuantityAvailable),
                    last_updated: new Date(),
                },
            });
        }
    }
    async releaseStock(tx, productId, locationId, quantity, productVariantId) {
        const existingStock = await tx.stock_levels.findUnique({
            where: {
                product_id_product_variant_id_location_id: {
                    product_id: productId,
                    product_variant_id: productVariantId || null,
                    location_id: locationId,
                },
            },
        });
        if (existingStock) {
            const newQuantityReserved = existingStock.quantity_reserved - quantity;
            const newQuantityAvailable = existingStock.quantity_available + quantity;
            return tx.stock_levels.update({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: locationId,
                    },
                },
                data: {
                    quantity_reserved: Math.max(0, newQuantityReserved),
                    quantity_available: Math.max(0, newQuantityAvailable),
                    last_updated: new Date(),
                },
            });
        }
    }
    async updateStockLevel(tx, productId, locationId, quantityChange, productVariantId) {
        const existingStock = await tx.stock_levels.findUnique({
            where: {
                product_id_product_variant_id_location_id: {
                    product_id: productId,
                    product_variant_id: productVariantId || null,
                    location_id: locationId,
                },
            },
        });
        if (existingStock) {
            const newQuantityOnHand = existingStock.quantity_on_hand + quantityChange;
            return tx.stock_levels.update({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: locationId,
                    },
                },
                data: {
                    quantity_on_hand: Math.max(0, newQuantityOnHand),
                    last_updated: new Date(),
                },
            });
        }
        else {
            return tx.stock_levels.create({
                data: {
                    product_id: productId,
                    product_variant_id: productVariantId,
                    location_id: locationId,
                    quantity_on_hand: Math.max(0, quantityChange),
                    quantity_reserved: 0,
                    quantity_available: Math.max(0, quantityChange),
                    last_updated: new Date(),
                },
            });
        }
    }
};
exports.StockTransfersService = StockTransfersService;
exports.StockTransfersService = StockTransfersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], StockTransfersService);
//# sourceMappingURL=stock-transfers.service.js.map