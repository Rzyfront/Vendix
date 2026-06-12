/**
 * Safety guards for the Roku demo seed.
 *
 * Three independent layers:
 *   1. assertDev()         — refuse to run with NODE_ENV=production
 *   2. assertNotProduction() — refuse to run if DATABASE_URL points to prod
 *   3. assertRokuOrg()     — refuse to run if the target org is not Roku
 *
 * The --confirm-prod-db flag is the explicit override (off by default).
 */

import type { PrismaClient } from '@prisma/client';

// Real local-dev Roku tenant (org 6 / store 10) — owned by rzyfront@gmail.com.
// The seed ATTACHES demo data to this tenant; it must never recreate or
// delete the org/store/real users themselves.
const ROKU_ORG_SLUG = 'roku';
const ROKU_STORE_SLUG = 'roku';

const PROD_URL_PATTERNS: RegExp[] = [
  /prod/i,
  /production/i,
  /aws/i,
  /rds/i,
  /\.amazonaws\.com/i,
  /vendix-prod/i,
];

export function assertDev(allowProdDb: boolean): void {
  if (process.env.NODE_ENV === 'production' && !allowProdDb) {
    console.error('❌ Refusing to run in NODE_ENV=production.');
    console.error('   Pass --confirm-prod-db to override (DO NOT do this in real prod).');
    process.exit(2);
  }
}

export function assertNotProduction(allowProdDb: boolean): void {
  if (allowProdDb) return;
  const dbUrl = process.env.DATABASE_URL ?? '';
  for (const pattern of PROD_URL_PATTERNS) {
    if (pattern.test(dbUrl)) {
      console.error(`❌ Refusing to run against a production-shaped DATABASE_URL.`);
      console.error(`   Pattern matched: ${pattern}`);
      console.error(`   Pass --confirm-prod-db to override.`);
      process.exit(2);
    }
  }
}

export async function assertRokuOrg(
  prisma: PrismaClient,
  allowProdDb: boolean,
): Promise<void> {
  // Allow a fresh DB where the org doesn't exist yet — we'll create it.
  if (allowProdDb) return;

  const org = await prisma.organizations.findUnique({
    where: { slug: ROKU_ORG_SLUG },
  });
  if (!org) {
    // Fresh DB: no risk. Allow creation.
    return;
  }
  // Org exists. Sanity-check that its slug/name matches Roku.
  if (org.slug !== ROKU_ORG_SLUG) {
    console.error(
      `❌ Organization with slug "${ROKU_ORG_SLUG}" exists but with mismatched slug: ${org.slug}`,
    );
    process.exit(2);
  }
  // And confirm a store with the expected slug exists OR will be created.
  const store = await prisma.stores.findFirst({
    where: { organization_id: org.id, slug: ROKU_STORE_SLUG },
  });
  if (store && store.organization_id !== org.id) {
    console.error(
      `❌ Store "${ROKU_STORE_SLUG}" exists under a different organization.`,
    );
    process.exit(2);
  }
}

export const ROKU_IDENTIFIERS = {
  orgSlug: ROKU_ORG_SLUG,
  orgName: 'Roku Colombia',
  orgTaxId: '901234567-8',
  storeSlug: ROKU_STORE_SLUG,
  storeName: 'Roku',
  storeCode: 'ROKU001',
  storeType: 'hybrid' as const,
};
