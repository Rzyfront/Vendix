import 'dotenv/config';

import { GlobalPrismaService } from '../src/prisma/services/global-prisma.service';
import {
  FiscalArea,
  normalizeFiscalStatusBlock,
} from '../src/common/interfaces/fiscal-status.interface';

const AREAS: FiscalArea[] = ['invoicing', 'accounting', 'payroll'];

function legacyEnabled(settings: any, area: FiscalArea): boolean {
  if (settings?.module_flows?.[area]) {
    return settings.module_flows[area].enabled !== false;
  }
  if (!settings?.module_flows && area === 'accounting' && settings?.accounting_flows) {
    return true;
  }
  if (!settings?.module_flows) return true;
  return false;
}

function fiscalEnabled(settings: any, area: FiscalArea): boolean {
  const state = normalizeFiscalStatusBlock(settings?.fiscal_status)[area].state;
  return state === 'ACTIVE' || state === 'LOCKED';
}

async function main() {
  const prisma = new GlobalPrismaService();
  await prisma.$connect();

  try {
    const client = prisma.withoutScope() as any;
    const stores = await client.stores.findMany({
      where: { is_active: true },
      select: {
        id: true,
        organization_id: true,
        store_settings: { select: { settings: true } },
        organizations: {
          select: {
            fiscal_scope: true,
            organization_settings: { select: { settings: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const discrepancies: Array<{
      organization_id: number;
      store_id: number;
      area: FiscalArea;
      legacy: boolean;
      fiscal: boolean;
    }> = [];
    let missingFiscalStatus = 0;

    const orgGroups = new Map<
      number,
      {
        fiscal_scope: 'STORE' | 'ORGANIZATION';
        orgSettings: any;
        stores: Array<{ id: number; storeSettings: any }>;
      }
    >();

    for (const store of stores) {
      const storeSettings = (store.store_settings?.settings as any) || {};
      const orgSettings =
        (store.organizations?.organization_settings?.settings as any) || {};
      const fiscalScope =
        (store.organizations?.fiscal_scope as 'STORE' | 'ORGANIZATION') ||
        'STORE';

      const group = orgGroups.get(store.organization_id) ?? {
        fiscal_scope: fiscalScope,
        orgSettings,
        stores: [],
      };
      group.stores.push({ id: store.id, storeSettings });
      orgGroups.set(store.organization_id, group);
    }

    for (const [organization_id, group] of orgGroups.entries()) {
      if (group.fiscal_scope === 'ORGANIZATION') {
        if (!group.orgSettings.fiscal_status) missingFiscalStatus++;
        for (const area of AREAS) {
          // OR-consolidate legacy across all stores in org
          const legacy = group.stores.some((s) =>
            legacyEnabled(s.storeSettings, area),
          );
          const fiscal = fiscalEnabled(group.orgSettings, area);
          if (legacy && !fiscal) {
            discrepancies.push({
              organization_id,
              store_id: 0,
              area,
              legacy,
              fiscal,
            });
          }
        }
      } else {
        for (const store of group.stores) {
          if (!store.storeSettings.fiscal_status) missingFiscalStatus++;
          for (const area of AREAS) {
            const legacy = legacyEnabled(store.storeSettings, area);
            const fiscal = fiscalEnabled(store.storeSettings, area);
            if (legacy && !fiscal) {
              discrepancies.push({
                organization_id,
                store_id: store.id,
                area,
                legacy,
                fiscal,
              });
            }
          }
        }
      }
    }

    const report = {
      checked_stores: stores.length,
      missing_fiscal_status: missingFiscalStatus,
      discrepancies_count: discrepancies.length,
      discrepancies,
    };

    console.log(JSON.stringify(report, null, 2));
    if (discrepancies.length > 0 || missingFiscalStatus > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
