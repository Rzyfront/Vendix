#!/usr/bin/env node
/**
 * Reset database script
 * Clears all data and re-seeds
 */

import { clearDatabase } from '../database.js';
import { seedDatabase } from '../../../seed.js';

async function main() {
  try {
    console.log('🔄 Resetting database...');

    // 1. Clean database
    console.log('🧹 Step 1: Cleaning database...');
    const cleanResult = await clearDatabase();
    console.log('✅ Database cleaned');

    // 2. Seed database
    console.log('🌱 Step 2: Seeding database...');
    await seedDatabase();
    console.log('✅ Database seeded');

    console.log('✅ Reset completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

main();
