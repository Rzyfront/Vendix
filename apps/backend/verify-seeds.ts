import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/vendix_db?schema=public';
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function verifySeeds() {
  console.log('🔍 VERIFICANDO SEEDS DE MÉTODOS DE PAGO...\n');

  try {
    const paymentMethods = await prisma.system_payment_methods.findMany({
      select: {
        id: true,
        name: true,
        display_name: true,
        type: true,
        is_active: true,
        created_at: true
      },
      orderBy: { id: 'asc' }
    });

    console.log(`📊 MÉTODOS DE PAGO ENCONTRADOS: ${paymentMethods.length}\n`);

    paymentMethods.forEach((method, index) => {
      const status = method.is_active ? '✅ ACTIVO' : '❌ INACTIVO';
      console.log(`${index + 1}. [${method.id}] ${method.display_name}`);
      console.log(`   └─ Código: ${method.name}`);
      console.log(`   └─ Tipo: ${method.type}`);
      console.log(`   └─ Estado: ${status}`);
      console.log(`   └─ Creado: ${method.created_at.toLocaleString('es-MX')}\n`);
    });

    // Verificación específica de lo solicitado
    const cashMethod = paymentMethods.find(m => m.name === 'cash');
    const voucherMethod = paymentMethods.find(m => m.name === 'payment_vouchers');

    console.log('🎯 VERIFICACIÓN DE REQUERIMIENTOS:');
    console.log(`💰 Método Efectivo: ${cashMethod ? '✅ CREADO' : '❌ NO ENCONTRADO'}`);
    console.log(`🎫 Método Vouchers: ${voucherMethod ? '✅ CREADO' : '❌ NO ENCONTRADO'}`);

    if (cashMethod && voucherMethod) {
      console.log('\n🎉 ¡TODOS LOS SEEDS SOLICITADOS HAN SIDO EJECUTADOS EXITOSAMENTE!');
    } else {
      console.log('\n⚠️ FALTAN MÉTODOS DE PAGO POR CREAR');
    }

  } catch (error) {
    console.error('❌ Error verificando seeds:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifySeeds();