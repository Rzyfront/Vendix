/**
 * Production-safe seed runner
 *
 * Only runs lightweight, necessary seeds — avoids heavy seeds
 * like PUC chart of accounts that can cause OOM on constrained instances.
 *
 * Usage: npx tsx prisma/seed-production.ts
 */
import { getPrismaClient, disconnectPrisma } from './seeds/shared/client';
import { seedDefaultTemplates } from './seeds/default-templates.seed';
import { seedPermissionsAndRoles } from './seeds/permissions-roles.seed';
import { seedDefaultAccountMappings } from './seeds/default-account-mappings.seed';
import { seedDefaultPayrollRules } from './seeds/default-payroll-rules.seed';
import { seedAIEngineApps } from './seeds/ai-engine-apps.seed';

const seeds = [
  { name: 'Default Templates', fn: seedDefaultTemplates },
  { name: 'Permissions & Roles', fn: seedPermissionsAndRoles },
  { name: 'Default Account Mappings', fn: seedDefaultAccountMappings },
  { name: 'Default Payroll Rules', fn: seedDefaultPayrollRules },
  { name: 'AI Engine Applications', fn: seedAIEngineApps },
];

async function main() {
  const startTime = Date.now();
  console.log('🌱 Production seed runner — lightweight seeds only');
  console.log(`📋 Seeds to run: ${seeds.length}\n`);

  const prisma = getPrismaClient();
  let success = 0;
  let failed = 0;

  for (const seed of seeds) {
    console.log(`▶️  [${seed.name}]`);
    try {
      await seed.fn(prisma);
      console.log(`✅ ${seed.name} completed\n`);
      success++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${seed.name} failed: ${msg}\n`);
      failed++;
    }
  }

  await disconnectPrisma();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`${'═'.repeat(50)}`);
  console.log(`📊 Done in ${duration}s — ${success} succeeded, ${failed} failed`);
  console.log(`${'═'.repeat(50)}`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('💥 Seed process failed:', e);
  process.exit(1);
});
