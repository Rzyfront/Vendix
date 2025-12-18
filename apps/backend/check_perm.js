
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const perm = await prisma.permissions.findFirst({
        where: { name: 'store:products:bulk:upload' }
    });
    console.log('Permission found:', perm);
    if (perm) {
        const roles = await prisma.role_permissions.findMany({
            where: { permission_id: perm.id },
            include: { roles: true }
        });
        console.log('Assigned to roles:', roles.map(r => r.roles.name));
    }
}

check()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
