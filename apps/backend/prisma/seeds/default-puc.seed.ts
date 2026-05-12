import { Prisma, PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';
import { getColombiaPucAccounts } from '../../src/common/services/data/colombia-puc.data';

export interface SeedDefaultPucResult {
  accounts_created: number;
}

/**
 * DEPENDENCIES: Requires an organization to exist.
 *
 * Seeds the Colombian PUC (Plan Único de Cuentas) chart of accounts
 * for a given organization. Covers the full SGE (Sistema de Gestión Empresarial)
 * scope — not just comerciantes but also servicios, manufactura, and NIIF.
 *
 * Based on Decreto 2650 de 1993 and Resolución 040 de 2023.
 *
 * Idempotency model:
 *   The DB has a partial UNIQUE INDEX `chart_of_accounts_entity_code_uidx`
 *   on (accounting_entity_id, code) WHERE accounting_entity_id IS NOT NULL.
 *   The legacy compound unique (organization_id, code) was DROPPED in
 *   migration 20260503020000_accounting_entities_inventory_valuation.
 *
 *   Because the unique is *partial* and Prisma cannot model partial indexes
 *   in @@unique, we cannot use a native `upsert` here. Instead this seed:
 *     1. Resolves parent_id by re-reading the DB on every run (parents are
 *        created before children because the PUC array is level-ordered).
 *     2. Finds the existing row by full business key (org, entity, code).
 *     3. Updates if found, creates otherwise — and falls back to update
 *        on P2002 (unique violation) to absorb races / partial-state runs.
 *     4. Always re-applies parent_id, level, and metadata so re-runs
 *        converge to the canonical PUC even if intermediate edits drifted.
 *
 * @param organization_id - The organization to seed accounts for
 * @param prisma - Optional PrismaClient instance
 */
export async function seedDefaultPuc(
  organization_id: number,
  prisma?: PrismaClient,
): Promise<SeedDefaultPucResult> {
  const client = prisma || getPrismaClient();

  const accounts = getColombiaPucAccounts();
  let accounts_created = 0;

  const accounting_entities = await client.accounting_entities.findMany({
    where: { organization_id, is_active: true },
    select: { id: true },
  });
  const accounting_entity_ids: (number | null)[] = accounting_entities.length
    ? accounting_entities.map((entity) => entity.id)
    : [null];

  for (const accounting_entity_id of accounting_entity_ids) {
    for (const account of accounts) {
      // Always re-resolve parent_id from DB. The PUC array is level-ordered,
      // so by the time we hit a child, its parent has already been
      // created/updated in this same iteration.
      let parent_id: number | null = null;
      if (account.parent_code) {
        const parent = await client.chart_of_accounts.findFirst({
          where: {
            organization_id,
            accounting_entity_id,
            code: account.parent_code,
          },
          select: { id: true },
        });
        parent_id = parent?.id ?? null;
      }

      const writeData = {
        name: account.name,
        account_type: account.account_type,
        nature: account.nature,
        parent_id,
        level: account.level,
        is_active: true,
        accepts_entries: account.accepts_entries,
      };

      const existing = await client.chart_of_accounts.findFirst({
        where: {
          organization_id,
          accounting_entity_id,
          code: account.code,
        },
        select: { id: true },
      });

      if (existing) {
        await client.chart_of_accounts.update({
          where: { id: existing.id },
          data: writeData,
        });
      } else {
        try {
          await client.chart_of_accounts.create({
            data: {
              organization_id,
              accounting_entity_id,
              code: account.code,
              ...writeData,
            },
          });
        } catch (error) {
          // Fallback: another concurrent run (or a partial unique on
          // (accounting_entity_id, code) when entity is NOT NULL) may have
          // created the row between findFirst and create. Resolve to update.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            const racy = await client.chart_of_accounts.findFirst({
              where: {
                organization_id,
                accounting_entity_id,
                code: account.code,
              },
              select: { id: true },
            });
            if (!racy) {
              throw error;
            }
            await client.chart_of_accounts.update({
              where: { id: racy.id },
              data: writeData,
            });
          } else {
            throw error;
          }
        }
      }

      accounts_created++;
    }
  }

  console.log(
    `[PUC Seed] Created/updated ${accounts_created} accounts for organization ${organization_id}`,
  );

  return { accounts_created };
}

/**
 * Seeds PUC chart of accounts for ALL organizations.
 * Called by the main seed runner.
 */
export async function seedDefaultPucForAllOrgs(
  prisma?: PrismaClient,
): Promise<{ organizations_processed: number; total_accounts: number }> {
  const client = prisma || getPrismaClient();

  const organizations = await client.organizations.findMany({
    select: { id: true, name: true },
  });

  let total_accounts = 0;

  for (const org of organizations) {
    console.log(`[PUC Seed] Seeding PUC for organization "${org.name}" (id=${org.id})...`);
    const result = await seedDefaultPuc(org.id, client);
    total_accounts += result.accounts_created;
  }

  console.log(
    `[PUC Seed] Completed: ${organizations.length} organizations, ${total_accounts} total accounts`,
  );

  return { organizations_processed: organizations.length, total_accounts };
}
