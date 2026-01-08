import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { UpdateProfileDto, ChangePasswordDto, CreateAddressDto } from './dto/account.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AccountService {
    constructor(private readonly prisma: GlobalPrismaService) { }

    async getProfile(user_id: number) {
        const user = await this.prisma.users.findUnique({
            where: { id: user_id },
            select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
                phone: true,
                document_type: true,
                document_number: true,
                avatar_url: true,
                created_at: true,
            },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    async updateProfile(user_id: number, dto: UpdateProfileDto) {
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
            },
        });
    }

    async changePassword(user_id: number, dto: ChangePasswordDto) {
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

    async getOrders(store_id: number, user_id: number, page = 1, limit = 10) {
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.prisma.orders.findMany({
                where: {
                    store_id,
                    customer_id: user_id,
                },
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
                where: {
                    store_id,
                    customer_id: user_id,
                },
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

    async getOrderDetail(store_id: number, user_id: number, order_id: number) {
        const order = await this.prisma.orders.findFirst({
            where: {
                id: order_id,
                store_id,
                customer_id: user_id,
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

    async getAddresses(user_id: number) {
        return this.prisma.addresses.findMany({
            where: { user_id },
            orderBy: { is_primary: 'desc' },
        });
    }

    async createAddress(user_id: number, dto: CreateAddressDto) {
        // If is_primary, unset other primary addresses
        if (dto.is_primary) {
            await this.prisma.addresses.updateMany({
                where: { user_id, is_primary: true },
                data: { is_primary: false },
            });
        }

        return this.prisma.addresses.create({
            data: {
                user_id,
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

    async deleteAddress(user_id: number, address_id: number) {
        const address = await this.prisma.addresses.findFirst({
            where: { id: address_id, user_id },
        });

        if (!address) {
            throw new NotFoundException('Address not found');
        }

        await this.prisma.addresses.delete({
            where: { id: address_id },
        });

        return { message: 'Address deleted' };
    }
}
