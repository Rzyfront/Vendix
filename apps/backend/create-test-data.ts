import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createTestData() {
  try {
    console.log('🔍 Buscando organización existente...');
    const org = await prisma.organizations.findFirst();

    if (!org) {
      console.log('🏢 Creando organización de prueba...');
      const newOrg = await prisma.organizations.create({
        data: {
          name: 'Test Organization',
          slug: 'test-org',
          email: 'test@test.com',
          state: 'active'
        }
      });
      console.log('✅ Organización creada:', newOrg.id);

      console.log('🏪 Creando tienda de prueba...');
      const store = await prisma.stores.create({
        data: {
          name: 'Test Store',
          slug: 'test-store',
          organization_id: newOrg.id,
          domain: 'localhost:4200',
          is_active: true,
          store_type: 'online'
        }
      });
      console.log('✅ Tienda creada:', store.id);

      console.log('🌐 Creando configuración de dominio...');
      const domainSetting = await prisma.domain_settings.create({
        data: {
          hostname: 'localhost:4200',
          organization_id: newOrg.id,
          store_id: store.id,
          config: {
            type: 'vendix_core',
            environment: 'vendix_landing'
          }
        }
      });
      console.log('✅ Configuración de dominio creada');
    } else {
      console.log('🏢 Organización encontrada:', org.id);

      // Verificar si ya existe una tienda para localhost:4200
      const existingStore = await prisma.stores.findFirst({
        where: { domain: 'localhost:4200' }
      });

      if (!existingStore) {
        console.log('🏪 Creando tienda para localhost:4200...');
        const store = await prisma.stores.create({
          data: {
            name: 'Vendix Landing Store',
            slug: 'vendix-landing',
            organization_id: org.id,
            domain: 'localhost:4200',
            is_active: true,
            store_type: 'online'
          }
        });
        console.log('✅ Tienda creada:', store.id);
      } else {
        console.log('✅ Tienda ya existe para localhost:4200');
      }

      // Verificar configuración de dominio
      const existingDomain = await prisma.domain_settings.findFirst({
        where: { hostname: 'localhost:4200' }
      });

      if (!existingDomain) {
        const store = await prisma.stores.findFirst({
          where: { domain: 'localhost:4200' }
        });

        if (store) {
          console.log('🌐 Creando configuración de dominio...');
          const domainSetting = await prisma.domain_settings.create({
            data: {
              hostname: 'localhost:4200',
              organization_id: org.id,
              store_id: store.id,
              config: {
                type: 'vendix_core',
                environment: 'vendix_landing'
              }
            }
          });
          console.log('✅ Configuración de dominio creada');
        }
      } else {
        console.log('✅ Configuración de dominio ya existe');
      }
    }

    console.log('🎉 Datos de prueba creados exitosamente!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestData();
