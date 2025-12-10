
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const count = await prisma.store_payment_methods.count();
    console.log(`Total store_payment_methods: ${count}`);

    if (count > 0) {
        const methods = await prisma.store_payment_methods.findMany({
            take: 5,
        });
        console.log('Sample data:', JSON.stringify(methods, null, 2));
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
