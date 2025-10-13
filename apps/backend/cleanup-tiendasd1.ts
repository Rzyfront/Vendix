
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupTestData() {
  const orgSlug = 'tiendasd1';
  const userEmail = 'owner@tiendasd1.com';

  try {
    console.log(`🧹 Starting cleanup for organization: ${orgSlug}`);

    // Find the organization
    const organization = await prisma.organizations.findUnique({
      where: { slug: orgSlug },
      include: {
        users: true,
        stores: true,
        domain_settings: true,
      },
    });

    if (!organization) {
      console.log(`✅ Organization ${orgSlug} not found. No cleanup needed.`);
      return;
    }

    // Delete related data
    await prisma.user_roles.deleteMany({ where: { user_id: { in: organization.users.map(u => u.id) } } });
    await prisma.email_verification_tokens.deleteMany({ where: { user_id: { in: organization.users.map(u => u.id) } } });
    await prisma.refresh_tokens.deleteMany({ where: { user_id: { in: organization.users.map(u => u.id) } } });
    await prisma.addresses.deleteMany({ where: { organization_id: organization.id } });
    await prisma.addresses.deleteMany({ where: { store_id: { in: organization.stores.map(s => s.id) } } });
    await prisma.store_settings.deleteMany({ where: { store_id: { in: organization.stores.map(s => s.id) } } });
    await prisma.domain_settings.deleteMany({ where: { organization_id: organization.id } });
    await prisma.stores.deleteMany({ where: { organization_id: organization.id } });
    await prisma.users.deleteMany({ where: { organization_id: organization.id } });
    await prisma.organizations.delete({ where: { id: organization.id } });

    console.log(`✅ Successfully cleaned up data for organization: ${orgSlug}`);

  } catch (error) {
    console.error(`❌ Error during cleanup for ${orgSlug}:`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupTestData();
