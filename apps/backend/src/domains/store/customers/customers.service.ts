import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { AuditResource } from '../../superadmin/audit/audit.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class CustomersService {
    constructor(private readonly prisma: StorePrismaService) { }

    private async generateUniqueUsername(email: string): Promise<string> {
        let baseUsername = email.split('@')[0];
        // Eliminar caracteres especiales
        baseUsername = baseUsername.replace(/[^a-zA-Z0-9]/g, '');

        let username = baseUsername;
        let counter = 1;

        while (true) {
            const existingUser = await this.prisma.users.findUnique({
                where: { username },
            });

            if (!existingUser) {
                return username;
            }

            username = `${baseUsername}${counter}`;
            counter++;
        }
    }

    private generateTemporaryPassword(length = 10): string {
        const charset =
            'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        let password = '';
        for (let i = 0; i < length; ++i) {
            const randomIndex = Math.floor(Math.random() * charset.length);
            password += charset[randomIndex];
        }
        return password;
    }

    async create(storeId: number, dto: CreateCustomerDto) {
        const store = await this.prisma.stores.findUnique({
            where: { id: storeId },
        });

        if (!store) {
            throw new NotFoundException('Store not found');
        }

        // Check if user exists in the organization
        const existingUser = await this.prisma.users.findFirst({
            where: {
                email: dto.email,
                organization_id: store.organization_id,
            },
        });

        if (existingUser) {
            throw new ConflictException(
                'User with this email already exists in this organization',
            );
        }

        // Find customer role
        const customerRole = await this.prisma.roles.findFirst({
            where: { name: 'customer' },
        });

        if (!customerRole) {
            throw new BadRequestException('Customer role not found');
        }

        const password = this.generateTemporaryPassword();
        const hashedPassword = await bcrypt.hash(password, 12);
        const username = await this.generateUniqueUsername(dto.email);

        // Create user
        const user = await this.prisma.users.create({
            data: {
                email: dto.email,
                password: hashedPassword,
                first_name: dto.first_name,
                last_name: dto.last_name,
                phone: dto.phone,
                document_type: dto.document_type,
                document_number: dto.document_number,
                username: username,
                email_verified: false,
                organization_id: store.organization_id,
                user_roles: {
                    create: {
                        role_id: customerRole.id,
                    },
                },
                store_users: {
                    create: {
                        store_id: store.id,
                    },
                },
                user_settings: {
                    create: {
                        config: {
                            app: 'STORE_ECOMMERCE',
                            panel_ui: {
                                profile: true,
                                history: true,
                                dashboard: true,
                                favorites: true,
                                orders: true,
                                settings: true,
                            },
                        },
                    },
                },
            },
            include: {
                user_roles: true,
                store_users: true,
            },
        });

        return user;
    }

    async findAll(storeId: number, query?: { search?: string; page?: number; limit?: number }) {
        const { search, page = 1, limit = 20 } = query || {};
        const skip = (page - 1) * limit;

        const where: any = {
            store_users: {
                some: {
                    store_id: storeId,
                },
            },
            user_roles: {
                some: {
                    roles: {
                        name: 'customer',
                    },
                },
            },
        };

        if (search) {
            where.OR = [
                { first_name: { contains: search, mode: 'insensitive' } },
                { last_name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { document_number: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [data, total] = await Promise.all([
            this.prisma.users.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { created_at: 'desc' },
            }),
            this.prisma.users.count({ where }),
        ]);

        return {
            data,
            meta: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit)),
            },
        };
    }

    async findOne(storeId: number, id: number) {
        const user = await this.prisma.users.findFirst({
            where: {
                id,
                store_users: {
                    some: {
                        store_id: storeId,
                    },
                },
                user_roles: {
                    some: {
                        roles: {
                            name: 'customer',
                        },
                    },
                },
            },
        });

        if (!user) {
            throw new NotFoundException('Customer not found');
        }

        return user;
    }

    async update(storeId: number, id: number, dto: UpdateCustomerDto) {
        const user = await this.findOne(storeId, id);

        return this.prisma.users.update({
            where: { id: user.id },
            data: {
                first_name: dto.first_name,
                last_name: dto.last_name,
                phone: dto.phone,
                document_number: dto.document_number,
                document_type: dto.document_type,
                email: dto.email, // Can we update email? Usually requires verification, but for CRUD basic...
            },
        });
    }

    async remove(storeId: number, id: number) {
        const user = await this.findOne(storeId, id);

        // Check if user has orders or other dependencies that prevent deletion?
        // For now, standard delete might fail if foreign keys exist. 
        // Prisma `users` delete might be too aggressive if cascade is not set up or set up to cascade.
        // Safe delete often means soft delete or check dependencies. 
        // Given "CRUD Basico", I will attempt delete.

        return this.prisma.users.delete({
            where: { id: user.id },
        });
    }
}
