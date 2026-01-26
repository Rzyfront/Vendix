import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { UpdateProfileDto, ChangePasswordDto, CreateAddressDto, UpdateAddressDto } from './dto/account.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AccountService {
    constructor(private readonly prisma: EcommercePrismaService) { }

    async getProfile() {
        // user_id se obtiene del contexto del JWT
        const context = RequestContextService.getContext();
        const user_id = context?.user_id;

        if (!user_id) {
            throw new BadRequestException('User context required');
        }

        const user = await this.prisma.users.findUnique({
            where: { id: user_id },
            select: {
                id: true,
                username: true,
                email: true,
                first_name: true,
                last_name: true,
                phone: true,
                document_type: true,
                document_number: true,
                avatar_url: true,
                created_at: true,
                addresses: {
                    orderBy: { is_primary: 'desc' },
                },
            },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    async updateProfile(dto: UpdateProfileDto) {
        // user_id se obtiene del contexto del JWT
        const context = RequestContextService.getContext();
        const user_id = context?.user_id;

        if (!user_id) {
            throw new BadRequestException('User context required');
        }

        const user = await this.prisma.users.findUnique({
            where: { id: user_id },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return this.prisma.users.update({
            where: { id: user_id },
            data: {
                first_name: dto.first_name,
                last_name: dto.last_name,
                phone: dto.phone,
                document_type: dto.document_type,
                document_number: dto.document_number,
                avatar_url: dto.avatar_url,
                username: dto.username,
                updated_at: new Date(),
            },
            select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
                phone: true,
                document_type: true,
                document_number: true,
                avatar_url: true,
                username: true,
            },
        });
    }

    async changePassword(dto: ChangePasswordDto) {
        // user_id se obtiene del contexto del JWT
        const context = RequestContextService.getContext();
        const user_id = context?.user_id;

        if (!user_id) {
            throw new BadRequestException('User context required');
        }

        const user = await this.prisma.users.findUnique({
            where: { id: user_id },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        const is_valid = await bcrypt.compare(dto.current_password, user.password);
        if (!is_valid) {
            throw new BadRequestException('Current password is incorrect');
        }

        const hashed_password = await bcrypt.hash(dto.new_password, 12);

        await this.prisma.users.update({
            where: { id: user_id },
            data: { password: hashed_password, updated_at: new Date() },
        });

        return { message: 'Password changed successfully' };
    }

    async getOrders(page = 1, limit = 10) {
        // store_id y user_id se aplican automáticamente por EcommercePrismaService
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.prisma.orders.findMany({
                where: {}, // store_id y customer_id se aplican automáticamente
                skip,
                take: Number(limit),
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    order_number: true,
                    state: true,
                    grand_total: true,
                    currency: true,
                    created_at: true,
                    placed_at: true,
                    completed_at: true,
                    _count: {
                        select: { order_items: true },
                    },
                },
            }),
            this.prisma.orders.count({
                where: {}, // store_id y customer_id se aplican automáticamente
            }),
        ]);

        return {
            data: data.map((order) => ({
                ...order,
                item_count: order._count.order_items,
            })),
            meta: {
                total,
                page: Number(page),
                limit: Number(limit),
                total_pages: Math.ceil(total / Number(limit)),
            },
        };
    }

    async getOrderDetail(order_id: number) {
        // store_id y user_id se aplican automáticamente por EcommercePrismaService
        const order = await this.prisma.orders.findFirst({
            where: {
                id: order_id,
                // store_id y customer_id se aplican automáticamente
            },
            include: {
                order_items: {
                    include: {
                        products: {
                            include: {
                                product_images: {
                                    where: { is_main: true },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
                payments: {
                    include: {
                        store_payment_method: {
                            include: {
                                system_payment_method: true,
                            },
                        },
                    },
                },
                addresses_orders_shipping_address_idToaddresses: true,
            },
        });

        if (!order) {
            throw new NotFoundException('Order not found');
        }

        return {
            id: order.id,
            order_number: order.order_number,
            state: order.state,
            subtotal_amount: order.subtotal_amount,
            discount_amount: order.discount_amount,
            tax_amount: order.tax_amount,
            shipping_cost: order.shipping_cost,
            grand_total: order.grand_total,
            currency: order.currency,
            created_at: order.created_at,
            placed_at: order.placed_at,
            completed_at: order.completed_at,
            shipping_address: order.shipping_address_snapshot ||
                order.addresses_orders_shipping_address_idToaddresses,
            items: order.order_items.map((item) => ({
                id: item.id,
                product_name: item.product_name,
                variant_sku: item.variant_sku,
                variant_attributes: item.variant_attributes,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                image_url: item.products?.product_images?.[0]?.image_url || null,
            })),
            payments: order.payments.map((p) => ({
                id: p.id,
                amount: p.amount,
                state: p.state,
                method: p.store_payment_method?.system_payment_method?.display_name,
                paid_at: p.paid_at,
            })),
        };
    }

    async getAddresses() {
        // user_id se aplica automáticamente por EcommercePrismaService
        return this.prisma.addresses.findMany({
            where: {}, // user_id se aplica automáticamente
            orderBy: { is_primary: 'desc' },
        });
    }

    async createAddress(dto: CreateAddressDto) {
        // user_id se obtiene del contexto del JWT
        const context = RequestContextService.getContext();
        const user_id = context?.user_id;

        if (!user_id) {
            throw new BadRequestException('User context required');
        }

        // If is_primary, unset other primary addresses (user_id se aplica automáticamente)
        if (dto.is_primary) {
            await this.prisma.addresses.updateMany({
                where: { is_primary: true }, // user_id se aplica automáticamente
                data: { is_primary: false },
            });
        }

        // user_id se inyecta automáticamente
        return this.prisma.addresses.create({
            data: {
                address_line1: dto.address_line1,
                address_line2: dto.address_line2,
                city: dto.city,
                state_province: dto.state_province,
                country_code: dto.country_code,
                postal_code: dto.postal_code,
                phone_number: dto.phone_number,
                is_primary: dto.is_primary || false,
                type: 'shipping',
            },
        });
    }

    async deleteAddress(address_id: number) {
        // user_id se aplica automáticamente por EcommercePrismaService
        const address = await this.prisma.addresses.findFirst({
            where: {
                id: address_id,
                // user_id se aplica automáticamente
            },
        });

        if (!address) {
            throw new NotFoundException('Address not found');
        }

        await this.prisma.addresses.delete({
            where: { id: address_id },
        });

        return { message: 'Address deleted' };
    }

    async updateAddress(address_id: number, dto: UpdateAddressDto) {
        const context = RequestContextService.getContext();
        const user_id = context?.user_id;

        if (!user_id) {
            throw new BadRequestException('User context required');
        }

        // Verify address belongs to user
        const address = await this.prisma.addresses.findFirst({
            where: {
                id: address_id,
                user_id,
            },
        });

        if (!address) {
            throw new NotFoundException('Address not found');
        }

        // If is_primary, unset other primary addresses
        if (dto.is_primary) {
            await this.prisma.addresses.updateMany({
                where: { user_id, is_primary: true },
                data: { is_primary: false },
            });
        }

        return this.prisma.addresses.update({
            where: { id: address_id },
            data: {
                address_line1: dto.address_line1,
                address_line2: dto.address_line2,
                city: dto.city,
                state_province: dto.state_province,
                country_code: dto.country_code,
                postal_code: dto.postal_code,
                phone_number: dto.phone_number,
                is_primary: dto.is_primary,
                type: dto.type,
            },
        });
    }

    async setAddressPrimary(address_id: number) {
        const context = RequestContextService.getContext();
        const user_id = context?.user_id;

        if (!user_id) {
            throw new BadRequestException('User context required');
        }

        // Verify address belongs to user
        const address = await this.prisma.addresses.findFirst({
            where: {
                id: address_id,
                user_id,
            },
        });

        if (!address) {
            throw new NotFoundException('Address not found');
        }

        // Unset all primary addresses for this user
        await this.prisma.addresses.updateMany({
            where: { user_id },
            data: { is_primary: false },
        });

        // Set new primary
        return this.prisma.addresses.update({
            where: { id: address_id },
            data: { is_primary: true },
        });
    }
}
