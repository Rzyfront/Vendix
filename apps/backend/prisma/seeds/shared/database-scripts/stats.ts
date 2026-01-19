#!/usr/bin/env node
/**
 * Database stats script
 * Shows count of records in each table
 */

import { getDatabaseStats } from '../database.js';

async function main() {
  try {
    console.log('📊 Database Statistics:');
    console.log('');

    const stats = await getDatabaseStats();

    const maxKeyLength = Math.max(...Object.keys(stats).map(k => k.length));

    for (const [table, count] of Object.entries(stats)) {
      const paddedKey = table.padEnd(maxKeyLength);
      console.log(`   ${paddedKey}: ${count}`);
    }

    console.log('');
    console.log('✅ Stats retrieved successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error getting stats:', error);
    process.exit(1);
  }
}

main();
