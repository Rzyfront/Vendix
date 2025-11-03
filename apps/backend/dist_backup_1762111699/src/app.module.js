"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const auth_module_1 = require("./modules/auth/auth.module");
const prisma_module_1 = require("./prisma/prisma.module");
const users_module_1 = require("./modules/users/users.module");
const test_module_1 = require("./test/test.module");
const organizations_module_1 = require("./modules/organizations/organizations.module");
const stores_module_1 = require("./modules/stores/stores.module");
const addresses_module_1 = require("./modules/addresses/addresses.module");
const brands_module_1 = require("./modules/brands/brands.module");
const categories_module_1 = require("./modules/categories/categories.module");
const products_module_1 = require("./modules/products/products.module");
const taxes_module_1 = require("./modules/taxes/taxes.module");
const orders_module_1 = require("./modules/orders/orders.module");
const payments_module_1 = require("./modules/payments/payments.module");
const refunds_module_1 = require("./modules/refunds/refunds.module");
const inventory_module_1 = require("./modules/inventory/inventory.module");
const audit_module_1 = require("./modules/audit/audit.module");
const domains_module_1 = require("./modules/domains/domains.module");
const roles_module_1 = require("./modules/roles/roles.module");
const permissions_module_1 = require("./modules/permissions/permissions.module");
const bypass_email_module_1 = require("./modules/bypass-email/bypass-email.module");
const admin_organizations_module_1 = require("./modules/admin-organizations/admin-organizations.module");
const admin_stores_module_1 = require("./modules/admin-stores/admin-stores.module");
const admin_domains_module_1 = require("./modules/admin-domains/admin-domains.module");
const admin_roles_module_1 = require("./modules/admin-roles/admin-roles.module");
const admin_users_module_1 = require("./modules/admin-users/admin-users.module");
const core_1 = require("@nestjs/core");
const jwt_auth_guard_1 = require("./modules/auth/guards/jwt-auth.guard");
const request_context_service_1 = require("./common/context/request-context.service");
const request_context_interceptor_1 = require("./common/interceptors/request-context.interceptor");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '.env',
            }),
            auth_module_1.AuthModule,
            prisma_module_1.PrismaModule,
            organizations_module_1.OrganizationsModule,
            stores_module_1.StoresModule,
            users_module_1.UsersModule,
            addresses_module_1.AddressesModule,
            brands_module_1.BrandsModule,
            categories_module_1.CategoriesModule,
            products_module_1.ProductsModule,
            taxes_module_1.TaxesModule,
            orders_module_1.OrdersModule,
            payments_module_1.PaymentsModule,
            refunds_module_1.RefundsModule,
            inventory_module_1.InventoryModule,
            test_module_1.TestModule,
            domains_module_1.DomainsModule,
            audit_module_1.AuditModule,
            roles_module_1.RolesModule,
            permissions_module_1.PermissionsModule,
            bypass_email_module_1.BypassEmailModule,
            admin_organizations_module_1.AdminOrganizationsModule,
            admin_stores_module_1.AdminStoresModule,
            admin_domains_module_1.AdminDomainsModule,
            admin_roles_module_1.AdminRolesModule,
            admin_users_module_1.AdminUsersModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [
            app_service_1.AppService,
            request_context_service_1.RequestContextService,
            {
                provide: core_1.APP_GUARD,
                useClass: jwt_auth_guard_1.JwtAuthGuard,
            },
            {
                provide: core_1.APP_INTERCEPTOR,
                useClass: request_context_interceptor_1.RequestContextInterceptor,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map