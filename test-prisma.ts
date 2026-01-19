import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const fields = Object.keys((prisma as any).products);
    console.log("Product model properties:", fields);

    // Try to find a product and see its fields
    const product = await prisma.products.findFirst();
    console.log(
      "First product fields:",
      product ? Object.keys(product) : "No products found",
    );
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
