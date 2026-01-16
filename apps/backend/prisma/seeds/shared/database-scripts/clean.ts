#!/usr/bin/env node
/**
 * Clean database script
 * Usage: node clean.js [module]
 *   module (optional): 'products', 'users', 'organizations', 'permissions', 'templates'
 */

import { clearDatabase, clearModule } from '../database.js';

async function main() {
  const module = process.argv[2];

  try {
    if (module) {
      console.log(`🧹 Cleaning module: ${module}`);
      const result = await clearModule(module);
      console.log('✅ Module cleaned successfully');
      console.log('Result:', result);
    } else {
      console.log('🧹 Cleaning entire database...');
      const result = await clearDatabase();
      console.log('✅ Database cleaned successfully');
      console.log('Result:', result);
    }
    process.exit(0);
  } catch (error) {
    console.error('❌ Error cleaning database:', error);
    process.exit(1);
  }
}

main();
