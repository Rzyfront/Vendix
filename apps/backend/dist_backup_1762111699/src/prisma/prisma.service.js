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
var PrismaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const request_context_service_1 = require("../common/context/request-context.service");
let PrismaService = PrismaService_1 = class PrismaService {
    constructor() {
        this.logger = new common_1.Logger(PrismaService_1.name);
        console.log('🚀 [PrismaService] Constructor llamado - creando cliente base');
        const baseClient = new client_1.PrismaClient({
            log: ['query', 'info', 'warn', 'error'],
        });
        console.log('🚀 [PrismaService] Aplicando extensión de scope...');
        this.client = baseClient.$extends({
            name: 'organizationScope',
            query: {
                $allModels: {
                    async $allOperations({ operation, model, args, query }) {
                        const context = request_context_service_1.RequestContextService.getContext();
                        const orgScopedModels = [
                            'users',
                            'audit_logs',
                            'organization_settings',
                            'stores',
                            'domain_settings',
                            'addresses',
                            'inventory_locations',
                            'inventory_movements',
                            'inventory_adjustments',
                            'stock_reservations',
                            'purchase_orders',
                            'sales_orders',
                            'stock_transfers',
                            'return_orders',
                            'suppliers',
                        ];
                        const storeScopedModels = [
                            'store_users',
                            'login_attempts',
                            'domain_settings',
                            'addresses',
                            'categories',
                            'orders',
                            'payment_methods',
                            'products',
                            'store_settings',
                            'tax_categories',
                            'tax_rates',
                            'audit_logs',
                        ];
                        const isOrgScoped = orgScopedModels.includes(model);
                        const isStoreScoped = storeScopedModels.includes(model);
                        if (!context ||
                            (!isOrgScoped && !isStoreScoped) ||
                            context.is_super_admin) {
                            return query(args);
                        }
                        const { organization_id, store_id } = context;
                        const modifiedArgs = { ...args };
                        if (operation === 'create') {
                            modifiedArgs.data = { ...modifiedArgs.data };
                            if (isOrgScoped)
                                modifiedArgs.data.organization_id = organization_id;
                            if (isStoreScoped && store_id)
                                modifiedArgs.data.store_id = store_id;
                        }
                        if (operation === 'createMany') {
                            if (Array.isArray(modifiedArgs.data)) {
                                modifiedArgs.data = modifiedArgs.data.map((item) => ({
                                    ...item,
                                    ...(isOrgScoped && { organization_id: organization_id }),
                                    ...(isStoreScoped && store_id && { store_id: store_id }),
                                }));
                            }
                        }
                        const securityFilter = {};
                        if (isOrgScoped) {
                            securityFilter['organization_id'] = organization_id;
                        }
                        if (isStoreScoped && store_id) {
                            securityFilter['store_id'] = store_id;
                        }
                        if (Object.keys(securityFilter).length > 0) {
                            if ([
                                'findUnique',
                                'findFirst',
                                'findMany',
                                'count',
                                'update',
                                'updateMany',
                                'delete',
                                'deleteMany',
                            ].includes(operation)) {
                                modifiedArgs.where = {
                                    ...modifiedArgs.where,
                                    ...securityFilter,
                                };
                            }
                            if (operation === 'upsert') {
                                modifiedArgs.where = {
                                    ...modifiedArgs.where,
                                    ...securityFilter,
                                };
                                modifiedArgs.create = {
                                    ...modifiedArgs.create,
                                    ...securityFilter,
                                };
                            }
                        }
                        return query(modifiedArgs);
                    },
                },
            },
        });
        console.log('🚀 [PrismaService] Extensión aplicada exitosamente');
    }
    async onModuleInit() {
        await this.client.$connect();
        this.logger.log('✅ Prisma connected to database');
    }
    async enableShutdownHooks(app) {
        process.on('beforeExit', async () => {
            await this.client.$disconnect();
            await app.close();
        });
    }
    get users() {
        return this.client.users;
    }
    get organizations() {
        return this.client.organizations;
    }
    get stores() {
        return this.client.stores;
    }
    get domain_settings() {
        return this.client.domain_settings;
    }
    get addresses() {
        return this.client.addresses;
    }
    get audit_logs() {
        return this.client.audit_logs;
    }
    get organization_settings() {
        return this.client.organization_settings;
    }
    get brands() {
        return this.client.brands;
    }
    get categories() {
        return this.client.categories;
    }
    get customers() {
        return this.client.customers;
    }
    get inventory_movements() {
        return this.client.inventory_movements;
    }
    get inventory_snapshots() {
        return this.client.inventory_snapshots;
    }
    get inventory_transactions() {
        return this.client.inventory_transactions;
    }
    get login_attempts() {
        return this.client.login_attempts;
    }
    get order_items() {
        return this.client.order_items;
    }
    get order_item_taxes() {
        return this.client.order_item_taxes;
    }
    get orders() {
        return this.client.orders;
    }
    get payment_methods() {
        return this.client.payment_methods;
    }
    get payments() {
        return this.client.payments;
    }
    get product_categories() {
        return this.client.product_categories;
    }
    get product_images() {
        return this.client.product_images;
    }
    get product_tax_assignments() {
        return this.client.product_tax_assignments;
    }
    get product_variants() {
        return this.client.product_variants;
    }
    get products() {
        return this.client.products;
    }
    get refund_items() {
        return this.client.refund_items;
    }
    get refunds() {
        return this.client.refunds;
    }
    get reviews() {
        return this.client.reviews;
    }
    get store_settings() {
        return this.client.store_settings;
    }
    get user_settings() {
        return this.client.user_settings;
    }
    get store_users() {
        return this.client.store_users;
    }
    get tax_categories() {
        return this.client.tax_categories;
    }
    get tax_rates() {
        return this.client.tax_rates;
    }
    get taxes() {
        return this.client.taxes;
    }
    get email_verification_tokens() {
        return this.client.email_verification_tokens;
    }
    get refresh_tokens() {
        return this.client.refresh_tokens;
    }
    get roles() {
        return this.client.roles;
    }
    get user_roles() {
        return this.client.user_roles;
    }
    get password_reset_tokens() {
        return this.client.password_reset_tokens;
    }
    get permissions() {
        return this.client.permissions;
    }
    get role_permissions() {
        return this.client.role_permissions;
    }
    get inventory_locations() {
        return this.client.inventory_locations;
    }
    get stock_levels() {
        return this.client.stock_levels;
    }
    get inventory_batches() {
        return this.client.inventory_batches;
    }
    get inventory_serial_numbers() {
        return this.client.inventory_serial_numbers;
    }
    get suppliers() {
        return this.client.suppliers;
    }
    get supplier_products() {
        return this.client.supplier_products;
    }
    get inventory_adjustments() {
        return this.client.inventory_adjustments;
    }
    get stock_reservations() {
        return this.client.stock_reservations;
    }
    get purchase_orders() {
        return this.client.purchase_orders;
    }
    get purchase_order_items() {
        return this.client.purchase_order_items;
    }
    get sales_orders() {
        return this.client.sales_orders;
    }
    get sales_order_items() {
        return this.client.sales_order_items;
    }
    get stock_transfers() {
        return this.client.stock_transfers;
    }
    get stock_transfer_items() {
        return this.client.stock_transfer_items;
    }
    get return_orders() {
        return this.client.return_orders;
    }
    get return_order_items() {
        return this.client.return_order_items;
    }
    $transaction(...args) {
        return this.client.$transaction(...args);
    }
    $connect() {
        return this.client.$connect();
    }
    $disconnect() {
        return this.client.$disconnect();
    }
    withoutScope() {
        return new client_1.PrismaClient();
    }
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = PrismaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PrismaService);
//# sourceMappingURL=prisma.service.js.map