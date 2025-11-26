const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRoles() {
  const roles = await prisma.roles.findMany();
  console.log('Available roles:', roles);
  await prisma.$disconnect();
}

checkRoles().catch(console.error);
