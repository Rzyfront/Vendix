
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';

const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://username:password@localhost:5432/vendix_db?schema=public';
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🔧 Assigning bulk upload permissions...');

    const permsToAssign = [
        'store:products:bulk:upload',
        'store:products:bulk:template'
    ];

    const rolesToAssign = ['super_admin', 'owner', 'admin', 'manager'];

    for (const permName of permsToAssign) {
        const permission = await prisma.permissions.findFirst({
            where: { name: permName }
        });

        if (!permission) {
            console.error(`❌ Permission not found: ${permName}`);
            continue;
        }
        console.log(`✅ Found permission: ${permName}`);

        for (const roleName of rolesToAssign) {
            const role = await prisma.roles.findFirst({
                where: { name: roleName }
            });

            if (!role) {
                console.error(`❌ Role not found: ${roleName}`);
                continue;
            }

            await prisma.role_permissions.upsert({
                where: {
                    role_id_permission_id: {
                        role_id: role.id,
                        permission_id: permission.id,
                    }
                },
                create: {
                    role_id: role.id,
                    permission_id: permission.id,
                },
                update: {},
            });
            console.log(`   Linked to role: ${roleName}`);
        }
    }

    // Also verify super_admin has it (it should have all, but explicit link doesn't hurt if logic requires it, 
    // though super_admin usually bypasses guards. Guard bypasses if user.roles includes SUPER_ADMIN.
    // So we skip super_admin explicit assignment as per seed logic usually.)

}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
