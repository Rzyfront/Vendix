/**
 * FASE A — Reporte de discrepancias entre `fiscal_data` JSON y columnas
 * de `organizations`/`stores`. Solo lectura. No escribe nada.
 *
 * Por qué es un script y no parte del test suite: necesita una DB con datos
 * representativos para ser significativo, y la salida (tres listas) es
 * operativa, no asertiva.
 *
 * Las tres listas que emite:
 *   (a) COLUMNAS VACÍAS con dato en JSON — las que la Fase B corregirá.
 *   (b) COLUMNAS CON VALOR DISTINTO al JSON — discrepancias que requieren
 *       revisión humana. Un `fiscal_data` corrupto no debe contaminar columnas
 *       que podrían ser correctas.
 *   (c) TENANTS CON `municipality_code` en `fiscal_data` Y SIN fila en
 *       `addresses type='billing'` — el inventario de direcciones fiscales
 *       ausentes que hoy harían lanzar a `buildIssuerData`.
 *
 * Uso:
 *   DATABASE_URL=... npx ts-node src/scripts/fiscal-ssot/report-fiscal-discrepancies.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Discrepancy {
  organization_id: number;
  store_id: number | null;
  field: string;
  column_value: string | null;
  json_value: unknown;
  reason: 'empty-column-with-json' | 'column-mismatch';
}

async function main() {
  console.log('FASE A — Reporte de discrepancias fiscal_data vs columnas');
  console.log('='.repeat(60));

  const discrepancies: Discrepancy[] = [];

  // Organizations — `fiscal_data` lives inside `organization_settings.settings`
  // as a JSON sub-object, not as a column. The select pulls the settings JSON
  // and we extract the sub-object in the loop.
  const orgs = await prisma.organizations.findMany({
    select: {
      id: true,
      legal_name: true,
      tax_id: true,
      verification_digit: true,
      document_type: true,
      person_type: true,
      tax_regime: true,
      fiscal_responsibilities: true,
      ciiu_code: true,
      organization_settings: { select: { settings: true } },
    },
  });

  for (const org of orgs) {
    const fiscalData = (
      (org.organization_settings as any)?.settings?.fiscal_data ?? {}
    ) as Record<string, unknown>;
    if (!fiscalData || Object.keys(fiscalData).length === 0) continue;

    // (a) Columnas vacías con dato en JSON
    if (!org.legal_name && typeof fiscalData.legal_name === 'string') {
      discrepancies.push({
        organization_id: org.id,
        store_id: null,
        field: 'legal_name',
        column_value: org.legal_name,
        json_value: fiscalData.legal_name,
        reason: 'empty-column-with-json',
      });
    }
    if (!org.tax_id && (fiscalData.nit || fiscalData.tax_id)) {
      discrepancies.push({
        organization_id: org.id,
        store_id: null,
        field: 'tax_id',
        column_value: org.tax_id,
        json_value: fiscalData.nit ?? fiscalData.tax_id,
        reason: 'empty-column-with-json',
      });
    }
    if (!org.verification_digit && typeof fiscalData.nit_dv === 'string') {
      discrepancies.push({
        organization_id: org.id,
        store_id: null,
        field: 'verification_digit',
        column_value: org.verification_digit,
        json_value: fiscalData.nit_dv,
        reason: 'empty-column-with-json',
      });
    }
    if (!org.document_type && typeof fiscalData.nit_type === 'string') {
      discrepancies.push({
        organization_id: org.id,
        store_id: null,
        field: 'document_type',
        column_value: org.document_type,
        json_value: fiscalData.nit_type,
        reason: 'empty-column-with-json',
      });
    }
    if (!org.ciiu_code && (fiscalData.ciiu || fiscalData.ciiu_code)) {
      discrepancies.push({
        organization_id: org.id,
        store_id: null,
        field: 'ciiu_code',
        column_value: org.ciiu_code,
        json_value: fiscalData.ciiu ?? fiscalData.ciiu_code,
        reason: 'empty-column-with-json',
      });
    }

    // (b) Discrepancias
    if (
      org.tax_id &&
      typeof fiscalData.nit === 'string' &&
      org.tax_id !== fiscalData.nit.replace(/[^\d]/g, '')
    ) {
      discrepancies.push({
        organization_id: org.id,
        store_id: null,
        field: 'tax_id',
        column_value: org.tax_id,
        json_value: fiscalData.nit,
        reason: 'column-mismatch',
      });
    }
  }

  // Stores — idem: `fiscal_data` está en `store_settings.settings`, no es columna.
  const stores = await prisma.stores.findMany({
    select: {
      id: true,
      organization_id: true,
      legal_name: true,
      tax_id: true,
      tax_id_dv: true,
      nit_type: true,
      municipality_code: true,
      ciiu_code: true,
      store_settings: { select: { settings: true } },
    },
  });

  for (const store of stores) {
    const fiscalData = (
      (store.store_settings as any)?.settings?.fiscal_data ?? {}
    ) as Record<string, unknown>;
    if (!fiscalData || Object.keys(fiscalData).length === 0) continue;

    if (!store.legal_name && typeof fiscalData.legal_name === 'string') {
      discrepancies.push({
        organization_id: store.organization_id,
        store_id: store.id,
        field: 'legal_name',
        column_value: store.legal_name,
        json_value: fiscalData.legal_name,
        reason: 'empty-column-with-json',
      });
    }
    if (!store.tax_id && (fiscalData.nit || fiscalData.tax_id)) {
      discrepancies.push({
        organization_id: store.organization_id,
        store_id: store.id,
        field: 'tax_id',
        column_value: store.tax_id,
        json_value: fiscalData.nit ?? fiscalData.tax_id,
        reason: 'empty-column-with-json',
      });
    }
    if (!store.municipality_code && typeof fiscalData.municipality_code === 'string') {
      discrepancies.push({
        organization_id: store.organization_id,
        store_id: store.id,
        field: 'municipality_code',
        column_value: store.municipality_code,
        json_value: fiscalData.municipality_code,
        reason: 'empty-column-with-json',
      });
    }
  }

  // (c) Direcciones fiscales ausentes
  const addressesByOrg = await prisma.addresses.findMany({
    where: { type: 'billing' },
    select: { organization_id: true, store_id: true },
  });
  const hasBillingAddress = new Set<string>();
  for (const a of addressesByOrg) {
    hasBillingAddress.add(`${a.organization_id}:${a.store_id ?? 'null'}`);
  }

  const missingAddresses: Array<{ organization_id: number; store_id: number | null; municipality_code: string }> = [];
  for (const org of orgs) {
    const fiscalData = (
      (org.organization_settings as any)?.settings?.fiscal_data ?? {}
    ) as Record<string, unknown>;
    if (typeof fiscalData.municipality_code === 'string') {
      if (!hasBillingAddress.has(`${org.id}:null`)) {
        missingAddresses.push({
          organization_id: org.id,
          store_id: null,
          municipality_code: fiscalData.municipality_code,
        });
      }
    }
  }
  for (const store of stores) {
    const fiscalData = (
      (store.store_settings as any)?.settings?.fiscal_data ?? {}
    ) as Record<string, unknown>;
    if (typeof fiscalData.municipality_code === 'string') {
      if (!hasBillingAddress.has(`${store.organization_id}:${store.id}`)) {
        missingAddresses.push({
          organization_id: store.organization_id,
          store_id: store.id,
          municipality_code: fiscalData.municipality_code,
        });
      }
    }
  }

  // Output
  const emptyCols = discrepancies.filter((d) => d.reason === 'empty-column-with-json');
  const mismatches = discrepancies.filter((d) => d.reason === 'column-mismatch');

  console.log('\n--- Lista A: COLUMNAS VACÍAS con dato en JSON ---');
  console.log(`Total: ${emptyCols.length}`);
  for (const d of emptyCols) {
    console.log(`  org=${d.organization_id}${d.store_id ? ` store=${d.store_id}` : ''} field=${d.field}`);
  }

  console.log('\n--- Lista B: COLUMNAS con valor distinto al JSON (REVISIÓN HUMANA) ---');
  console.log(`Total: ${mismatches.length}`);
  for (const d of mismatches) {
    console.log(
      `  org=${d.organization_id}${d.store_id ? ` store=${d.store_id}` : ''} field=${d.field} column=${JSON.stringify(d.column_value)} json=${JSON.stringify(d.json_value)}`,
    );
  }

  console.log('\n--- Lista C: DIRECCIONES FISCALES AUSENTES ---');
  console.log(`Total: ${missingAddresses.length}`);
  for (const a of missingAddresses) {
    console.log(
      `  org=${a.organization_id}${a.store_id ? ` store=${a.store_id}` : ''} municipality_code=${a.municipality_code}`,
    );
  }

  console.log('\n' + '='.repeat(60));
  console.log('Resumen: A=' + emptyCols.length + ' B=' + mismatches.length + ' C=' + missingAddresses.length);
  console.log('Fase B solo corrige Lista A. Lista B va a revisión humana.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
