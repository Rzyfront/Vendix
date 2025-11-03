"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function cleanDatabase() {
    console.log('🧹 Iniciando limpieza completa de la base de datos...');
    try {
        console.log('🗑️  Eliminando datos existentes...');
        await prisma.role_permissions.deleteMany({});
        await prisma.user_roles.deleteMany({});
        await prisma.store_users.deleteMany({});
        await prisma.domain_settings.deleteMany({});
        await prisma.addresses.deleteMany({});
        await prisma.store_settings.deleteMany({});
        await prisma.organization_settings.deleteMany({});
        await prisma.refresh_tokens.deleteMany({});
        await prisma.login_attempts.deleteMany({});
        await prisma.users.deleteMany({});
        await prisma.stores.deleteMany({});
        await prisma.organizations.deleteMany({});
        await prisma.roles.deleteMany({});
        await prisma.permissions.deleteMany({});
        console.log('✅ Base de datos limpiada exitosamente');
        console.log('');
        console.log('📋 Tablas limpiadas:');
        console.log('  - role_permissions');
        console.log('  - user_roles');
        console.log('  - store_users');
        console.log('  - domain_settings');
        console.log('  - addresses');
        console.log('  - store_settings');
        console.log('  - organization_settings');
        console.log('  - refresh_tokens');
        console.log('  - login_attempts');
        console.log('  - users');
        console.log('  - stores');
        console.log('  - organizations');
        console.log('  - roles');
        console.log('  - permissions');
    }
    catch (error) {
        console.error('❌ Error durante la limpieza de la base de datos:', error);
        throw error;
    }
}
cleanDatabase()
    .catch((e) => {
    console.error('❌ Error fatal:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=clean.js.map