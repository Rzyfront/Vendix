/**
 * ROKU Demo Seed - CLI Entry Point
 *
 * Populates the "Roku" demo store with coherent historical fake data
 * across every domain of Vendix. DEV-ONLY. Never tied to production seeds.
 *
 * Usage:
 *   npx tsx apps/backend/scripts/roku-demo/populate-roku.ts [options]
 *
 * Options:
 *   --only=01,02,03       Run only the specified comma-separated stages
 *   --skip=08,09          Skip the specified comma-separated stages
 *   --months-back=6       How many months of historical data to generate (default 6)
 *   --reset               Wipe existing Roku data before populating
 *   --confirm-prod-db     Override production-DB guard (NEVER use in real prod)
 *   --seed=12345          Override the RNG seed for reproducible runs
 *   --verbose             Print extra debug logs
 *
 * Safety:
 *   - Aborts in NODE_ENV=production unless --confirm-prod-db is passed
 *   - Aborts if DATABASE_URL looks like a production database
 *   - Aborts if the existing organization is not "roku"
 */

import {
  getPrismaClient,
  disconnectPrisma,
} from '../../prisma/seeds/shared/client';
import { runStages, type StageContext } from './stages';
import { assertNotProduction, assertRokuOrg, assertDev } from './lib/guards';
import { wipeRoku } from './wipe-roku';

interface CliOptions {
  only?: string[];
  skip?: string[];
  monthsBack: number;
  reset: boolean;
  verbose: boolean;
  seed: number;
  allowProdDb: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    monthsBack: 6,
    reset: false,
    verbose: false,
    seed: 20260610,
    allowProdDb: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--only=')) {
      opts.only = arg.slice(7).split(',').map((s) => s.trim());
    } else if (arg.startsWith('--skip=')) {
      opts.skip = arg.slice(7).split(',').map((s) => s.trim());
    } else if (arg.startsWith('--months-back=')) {
      opts.monthsBack = parseInt(arg.slice(14), 10);
    } else if (arg === '--reset') {
      opts.reset = true;
    } else if (arg === '--verbose') {
      opts.verbose = true;
    } else if (arg.startsWith('--seed=')) {
      opts.seed = parseInt(arg.slice(7), 10);
    } else if (arg === '--confirm-prod-db') {
      opts.allowProdDb = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`⚠️  Unknown option: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Roku Demo Seed — populate-roku.ts

Usage: npx tsx apps/backend/scripts/roku-demo/populate-roku.ts [options]

Options:
  --only=01,02,03         Run only the specified comma-separated stages
  --skip=08,09            Skip the specified comma-separated stages
  --months-back=6         Months of historical data (default 6)
  --reset                 Wipe existing Roku data before populating
  --confirm-prod-db       Override production-DB guard (DANGEROUS)
  --seed=20260610         RNG seed for reproducibility
  --verbose               Print extra debug logs
  --help, -h              Show this help

Stages:
  01-foundation         org, store, users, fiscal config, PUC, mappings
  02-catalog            categories, brands, products, variants, taxes
  03-inventory          locations, stock, transactions, adjustments
  04-parties            customers, suppliers, addresses
  05-purchasing         POs, receptions, payments, AP
  06-sales              orders, payments, refunds, quotations, dispatches
  07-pos-cash           cash registers, wallets, AR, commissions
  08-accounting         expenses, bank, fixed_assets, accounting entries
  09-payroll            employees, payroll_runs, items, novelties
  10-withholdings       conceptos, calculos, ICA
  11-fiscal-dian        resolutions, transmissions, evidences
  12-obligations        obligaciones, declarations, close sessions
  13-exogenous          reports, lines
  14-misc               notifications, reviews, carts, wishlists
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  // === Safety guards ===
  assertDev(opts.allowProdDb);
  assertNotProduction(opts.allowProdDb);
  const prisma = getPrismaClient();
  await assertRokuOrg(prisma, opts.allowProdDb);

  // === Existing-data guard ===
  // Child event tables (order_items, notifications, evidences, ...) have no
  // natural unique key, so re-populating over existing data would duplicate
  // them. Require a clean slate: wipe via --reset or wipe-roku.ts first.
  const existingOrg = await prisma.organizations.findUnique({
    where: { slug: 'roku' },
  });
  if (existingOrg) {
    const existingProducts = await prisma.products.count({
      where: { stores: { organization_id: existingOrg.id } },
    });
    if (existingProducts > 0 && !opts.reset && !opts.only?.length) {
      console.error('❌ Roku demo data already exists.');
      console.error('   Re-running over existing data would duplicate child records.');
      console.error('   Use --reset to wipe first, or run wipe-roku.ts manually.');
      console.error('   (--only=NN is allowed for targeted re-runs at your own risk.)');
      await disconnectPrisma();
      process.exit(2);
    }
    if (opts.reset) {
      console.log('🧹 --reset: wiping existing Roku demo data first');
      await wipeRoku(prisma);
      console.log('');
    }
  }

  console.log('🎬 Roku Demo Seed — populating demo data');
  console.log(`   today:           ${new Date().toISOString().slice(0, 10)}`);
  console.log(`   monthsBack:      ${opts.monthsBack}`);
  console.log(`   seed:            ${opts.seed}`);
  console.log(`   reset:           ${opts.reset}`);
  console.log(`   only:            ${opts.only?.join(',') ?? 'all'}`);
  console.log(`   skip:            ${opts.skip?.join(',') ?? 'none'}`);
  console.log(`   verbose:         ${opts.verbose}`);
  console.log('');

  const ctx: StageContext = {
    prisma,
    options: opts,
    today: new Date('2026-06-10T12:00:00Z'),
    rng: null as any, // initialized in runStages
    log: (msg: string) => console.log(msg),
    data: {},
  };

  const startTime = Date.now();
  const results = await runStages(ctx);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('');
  console.log('═'.repeat(70));
  console.log(`📊 Roku Demo Seed Summary (${duration}s)`);
  console.log('═'.repeat(70));
  let total = 0;
  for (const r of results) {
    const stats = Object.entries(r.counts || {})
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log(`   ${r.ok ? '✅' : '❌'} ${r.name}${stats ? ` (${stats})` : ''}`);
    if (!r.ok && r.error) {
      console.log(`        ${r.error}`);
    }
    total += Object.values(r.counts || {}).reduce(
      (a, b) => a + (typeof b === 'number' ? b : 0),
      0,
    );
  }
  console.log('═'.repeat(70));
  console.log(`   Total records created/updated: ${total}`);
  console.log('═'.repeat(70));

  await disconnectPrisma();
  if (results.some((r) => !r.ok)) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Roku demo seed failed:');
    console.error(error);
    process.exit(1);
  });
}
