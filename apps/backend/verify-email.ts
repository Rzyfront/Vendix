
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyUserEmail() {
  const userEmail = 'owner@tiendasd1.com';
  try {
    // Primero encontrar el usuario por email
    const user = await prisma.users.findFirst({
      where: { email: userEmail },
    });

    if (!user) {
      console.error(`❌ User with email ${userEmail} not found.`);
      process.exit(1);
    }

    // Luego actualizar por id
    const updatedUser = await prisma.users.update({
      where: { id: user.id },
      data: { email_verified: true, state: 'active' },
    });
    console.log(`✅ Email for user ${updatedUser.email} has been verified successfully.`);
  } catch (error) {
    console.error(`❌ Failed to verify email for ${userEmail}.`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifyUserEmail();
