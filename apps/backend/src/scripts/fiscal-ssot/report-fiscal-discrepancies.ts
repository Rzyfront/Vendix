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
 *   (c) MUNICIPIO FISCAL IRRESOLUBLE — tenants sin municipio en `fiscal_data` NI
 *       en una dirección `billing` que lo traiga. Son exactamente los que hacen
 *       lanzar al resolvedor ESTRICTO al emitir. Se sub-divide en dos, porque el
 *       remedio es distinto: los que TIENEN `fiscal_data` empezaron a cargar su
 *       identidad y se detuvieron (falta un campo), y los que NO lo tienen nunca
 *       empezaron (falta el flujo completo).
 *
 * Uso:
 *   DATABASE_URL=... npx ts-node src/scripts/fiscal-ssot/report-fiscal-discrepancies.ts
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

// Bajo Prisma 7 el cliente se construye SIEMPRE con driver adapter: un
// `new PrismaClient()` a secas lanza `PrismaClientInitializationError`
// («needs to be constructed with a non-empty, valid PrismaClientOptions»).
// Es el mismo patrón de `BasePrismaService` y de los seeds — no se inventa uno
// nuevo aquí. El script solo lee, pero necesita conectarse igual que la app.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

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

  // (c) MUNICIPIO FISCAL IRRESOLUBLE — el predicado es el espejo del `if` del
  //     resolvedor, no una traducción a prosa.
  //
  // `resolveTenantFiscalIdentity` lanza así:
  //
  //     municipality_code = fiscal_data.municipality_code || address.municipality_code
  //     if (!municipality_code) throw
  //
  // Dos fuentes, y falla cuando NINGUNA la tiene. Este reporte tiene que replicar
  // exactamente esa condición.
  //
  // Antes decía `if (typeof fiscalData.municipality_code === 'string')`, o sea
  // listaba a quienes SÍ declaran municipio y les falta la fila de dirección. Ésos
  // están bien: el `||` lee el JSON primero y nunca llega a la dirección. El
  // conjunto reportado era el complemento del buscado — un falso positivo y un
  // falso negativo a la vez.
  //
  // Y no dio un número raro que invitara a revisar: como casi nadie declara el
  // municipio en el JSON, el conjunto equivocado salía VACÍO y el reporte decía
  // `C = 0`. El correcto tiene 47 tiendas. Un cero tranquilizador es más peligroso
  // que un número absurdo.
  //
  // Segundo arreglo: `hasBillingAddress` solo comprobaba que la fila EXISTIERA.
  // La tienda 97 tenía dirección desde siempre con `municipality_code` NULL —
  // existir no es servir. Ahora se exige que la fila traiga el municipio.
  // Tercer arreglo, y el más traicionero: una fila de `addresses` cuelga de UNO de
  // los dos dueños, no de los dos. La dirección `billing` de la tienda 97 tiene
  // `store_id = 97` y `organization_id = NULL`, así que una clave compuesta
  // `${organization_id}:${store_id}` produce `null:97` y jamás cuadra con el
  // `75:97` que se busca. La tienda quedaba reportada como sin municipio teniendo
  // uno. Se indexa por dueño, en dos conjuntos separados.
  const billingAddresses = await prisma.addresses.findMany({
    where: { type: 'billing', municipality_code: { not: null } },
    select: { organization_id: true, store_id: true },
  });
  const orgHasMunicipality = new Set<number>();
  const storeHasMunicipality = new Set<number>();
  for (const a of billingAddresses) {
    if (a.store_id != null) storeHasMunicipality.add(a.store_id);
    else if (a.organization_id != null) orgHasMunicipality.add(a.organization_id);
  }

  /** Municipio declarado en el JSON, no vacío. */
  const jsonHasMunicipality = (fiscalData: Record<string, unknown>) =>
    typeof fiscalData.municipality_code === 'string' &&
    !!fiscalData.municipality_code.trim();

  const missingAddresses: Array<{
    organization_id: number;
    store_id: number | null;
    /** `true` = empezó a cargar identidad y se detuvo; `false` = nunca empezó. */
    has_fiscal_data: boolean;
  }> = [];
  for (const org of orgs) {
    const fiscalData = (
      (org.organization_settings as any)?.settings?.fiscal_data ?? {}
    ) as Record<string, unknown>;
    if (
      !jsonHasMunicipality(fiscalData) &&
      !orgHasMunicipality.has(org.id)
    ) {
      missingAddresses.push({
        organization_id: org.id,
        store_id: null,
        has_fiscal_data: Object.keys(fiscalData).length > 0,
      });
    }
  }
  for (const store of stores) {
    const fiscalData = (
      (store.store_settings as any)?.settings?.fiscal_data ?? {}
    ) as Record<string, unknown>;
    if (
      !jsonHasMunicipality(fiscalData) &&
      !storeHasMunicipality.has(store.id)
    ) {
      missingAddresses.push({
        organization_id: store.organization_id,
        store_id: store.id,
        has_fiscal_data: Object.keys(fiscalData).length > 0,
      });
    }
  }

  // Output
  //
  // CADA TOTAL VA CONTRA SU DENOMINADOR. Un `Total: 0` a secas significa dos cosas
  // incompatibles —«nada que corregir» y «no examiné nada»— y son indistinguibles
  // justo cuando más importa distinguirlas. Este reporte ya devolvió `C = 0` sobre
  // un problema real de 47 tiendas; con el denominador a la vista, `0 de 48` y
  // `0 de 0` dejan de leerse igual.
  const emptyCols = discrepancies.filter((d) => d.reason === 'empty-column-with-json');
  const mismatches = discrepancies.filter((d) => d.reason === 'column-mismatch');
  const examined = `${orgs.length} organizaciones + ${stores.length} tiendas`;

  console.log(`\nExaminados: ${examined}`);
  if (orgs.length === 0 && stores.length === 0) {
    console.log(
      '  !! CERO tenants examinados — los totales de abajo NO son evidencia de salud.',
    );
  }

  console.log('\n--- Lista A: COLUMNAS VACÍAS con dato en JSON ---');
  console.log(`Total: ${emptyCols.length} (de ${examined})`);
  for (const d of emptyCols) {
    console.log(`  org=${d.organization_id}${d.store_id ? ` store=${d.store_id}` : ''} field=${d.field}`);
  }

  console.log('\n--- Lista B: COLUMNAS con valor distinto al JSON (REVISIÓN HUMANA) ---');
  console.log(`Total: ${mismatches.length} (de ${examined})`);
  for (const d of mismatches) {
    console.log(
      `  org=${d.organization_id}${d.store_id ? ` store=${d.store_id}` : ''} field=${d.field} column=${JSON.stringify(d.column_value)} json=${JSON.stringify(d.json_value)}`,
    );
  }

  console.log('\n--- Lista C: MUNICIPIO FISCAL IRRESOLUBLE ---');
  console.log(
    '(sin municipio en `fiscal_data` NI en una dirección `billing` con municipio;',
  );
  console.log(
    ' son los tenants para los que el resolvedor ESTRICTO lanza al emitir)',
  );
  const started = missingAddresses.filter((a) => a.has_fiscal_data);
  const neverStarted = missingAddresses.filter((a) => !a.has_fiscal_data);
  console.log(`Total: ${missingAddresses.length} (de ${examined})`);
  console.log(
    `\n  C1 — CON fiscal_data, sin municipio: ${started.length}` +
      '  (empezaron y se detuvieron; les falta un campo)',
  );
  for (const a of started) {
    console.log(
      `      org=${a.organization_id}${a.store_id ? ` store=${a.store_id}` : ''}`,
    );
  }
  console.log(
    `\n  C2 — SIN fiscal_data: ${neverStarted.length}` +
      '  (nunca cargaron identidad fiscal; les falta el flujo completo)',
  );
  for (const a of neverStarted) {
    console.log(
      `      org=${a.organization_id}${a.store_id ? ` store=${a.store_id}` : ''}`,
    );
  }

  console.log('\n' + '='.repeat(60));
  console.log(
    `Resumen: A=${emptyCols.length} B=${mismatches.length} C=${missingAddresses.length} (C1=${started.length} C2=${neverStarted.length})  (examinados: ${examined})`,
  );
  console.log('Fase B solo corrige Lista A. Lista B va a revisión humana.');
  console.log(
    'Lista C NO se migra: no hay dato del que derivar un municipio, e inventarlo ' +
      'produce el rechazo que el paso 2 busca evitar. Se contacta al tenant.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
