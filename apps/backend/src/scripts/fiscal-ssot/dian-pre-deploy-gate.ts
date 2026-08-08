/**
 * Pre-deploy gate para el paso 4 del plan de SSOT.
 *
 * Antes de desplegar el cambio de `loadIssuerData` en producción, este script
 * contrasta la identidad que produce el resolvedor único contra la que produce
 * la cascada actual de `buildIssuerData` para cada tenant con
 * `dian_configurations` activa. Si hay diferencias en cualquier campo, el
 * script emite la lista y sale con código no-cero — el deploy se detiene hasta
 * entender la causa.
 *
 * Por qué es un script y no un test: necesita una conexión a la DB de
 * producción (o staging equivalente) con datos representativos. La salida es
 * operativa (reporte + exit code), no asertiva.
 *
 * Modo de uso:
 *   - Producción (vía docker exec, según la práctica del runbook):
 *     ssh ... 'sudo docker exec -i vendix-backend node -e "
 *       const { runPreDeployGate } = require('./dist/scripts/fiscal-ssot/dian-pre-deploy-gate');
 *       runPreDeployGate().then(r => process.exit(r.differences > 0 ? 1 : 0));
 *     "'
 *   - Staging:
 *     DATABASE_URL=... npx ts-node src/scripts/fiscal-ssot/dian-pre-deploy-gate.ts
 *
 * Exit code 0 = identidad idéntica, deploy puede proceder.
 * Exit code 1 = diferencias detectadas, deploy se detiene.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { resolveIssuerFiscalIdentity } from '../../domains/store/invoicing/utils/fiscal-issuer.util';
import { DianIssuerData } from '../../domains/store/invoicing/providers/dian-direct/interfaces/dian-config.interface';

// Bajo Prisma 7 el cliente se construye SIEMPRE con driver adapter: un
// `new PrismaClient()` a secas lanza `PrismaClientInitializationError`. Mismo
// patrón que `BasePrismaService`. Este gate solo lee y no envía nada a la DIAN.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

interface FieldDiff {
  tenant: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
}

/**
 * Reconstruye el `DianIssuerData` con la cascada original (pre-paso-4). Esta
 * función se mantiene aquí como referencia para el gate; el código de
 * producción eliminado está en el historial de git (commit anterior al
 * 92e5b91a7).
 */
function legacyCascade(args: {
  config: { nit: string; nit_dv: string | null; name?: string | null };
  entity: { legal_name: string | null; name: string | null };
  organization: {
    legal_name: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    document_type: string | null;
    person_type: string | null;
  } | null;
  address: {
    address_line1: string | null;
    city: string | null;
    state_province: string | null;
    municipality_code: string | null;
    postal_code: string | null;
    phone_number: string | null;
    country_code: string | null;
  } | null;
  fiscalData: Record<string, unknown> | null;
}): DianIssuerData {
  const fiscal = args.fiscalData ?? {};
  const nit = args.config.nit;
  const nit_dv = args.config.nit_dv || '0';
  const legal_name =
    (typeof fiscal['legal_name'] === 'string' && fiscal['legal_name']) ||
    args.config.name?.trim() ||
    args.entity.legal_name?.trim() ||
    args.organization?.legal_name?.trim() ||
    args.organization?.name?.trim() ||
    '';
  const municipality_code =
    (typeof fiscal['municipality_code'] === 'string' &&
      fiscal['municipality_code']) ||
    args.address?.municipality_code ||
    '';
  const address_line =
    (typeof fiscal['fiscal_address'] === 'string' && fiscal['fiscal_address']) ||
    args.address?.address_line1 ||
    '';
  const city_name =
    (typeof fiscal['city'] === 'string' && fiscal['city']) ||
    args.address?.city ||
    '';
  const department_name =
    (typeof fiscal['department'] === 'string' && fiscal['department']) ||
    args.address?.state_province ||
    municipality_code.slice(0, 2);
  const document_type =
    (typeof fiscal['nit_type'] === 'string' && fiscal['nit_type'] === 'NIT'
      ? '31'
      : args.organization?.document_type) || '31';
  const person_type =
    (typeof fiscal['person_type'] === 'string' && fiscal['person_type'] === 'JURIDICA'
      ? '1'
      : args.organization?.person_type) || '1';
  const regime =
    typeof fiscal['tax_regime'] === 'string'
      ? fiscal['tax_regime'].toUpperCase()
      : '';
  const tax_regime = regime === 'SIMPLIFICADO' ? '49' : '48';
  const tax_scheme =
    (typeof fiscal['tax_scheme'] === 'string' && fiscal['tax_scheme']) || 'O-15';

  return {
    document_type,
    nit,
    nit_dv,
    legal_name,
    trade_name: args.entity.name?.trim() || undefined,
    address_line,
    city_code: municipality_code,
    city_name,
    department_code: municipality_code.slice(0, 2),
    department_name,
    country_code:
      (typeof fiscal['country'] === 'string' && fiscal['country']) || 'CO',
    postal_code: args.address?.postal_code || undefined,
    phone: args.address?.phone_number || args.organization?.phone || undefined,
    email: args.organization?.email || '',
    tax_regime,
    tax_scheme,
    person_type,
  };
}

function diff(
  old: DianIssuerData,
  neu: DianIssuerData,
  tenant: string,
): FieldDiff[] {
  const fields: Array<keyof DianIssuerData> = [
    'document_type',
    'nit',
    'nit_dv',
    'legal_name',
    'trade_name',
    'address_line',
    'city_code',
    'city_name',
    'department_code',
    'department_name',
    'country_code',
    'postal_code',
    'phone',
    'email',
    'tax_regime',
    'tax_scheme',
    'person_type',
  ];
  const out: FieldDiff[] = [];
  for (const f of fields) {
    const a = old[f];
    const b = neu[f];
    if (a !== b && !(a == null && b == null)) {
      out.push({ tenant, field: f, old_value: a, new_value: b });
    }
  }
  return out;
}

export async function runPreDeployGate(): Promise<{ differences: number }> {
  console.log('Pre-deploy gate DIAN — paso 4 del plan SSOT');
  console.log('='.repeat(60));

  const configs = await prisma.dian_configurations.findMany({
    where: { enablement_status: { in: ['testing', 'test_set_passed', 'enabled'] } },
    include: {
      accounting_entity: {
        include: {
          // `type: 'billing'` NO es opcional: es la dirección FISCAL, y es el
          // filtro que aplican TODOS los consumidores reales
          // (`dian-test.service.ts`, `invoice-pdf.service.ts`). Sin él este gate
          // toma la primera dirección cualquiera y reporta un falso positivo:
          // la tienda 97 tiene `store_physical` id=701 (is_primary=true,
          // municipality_code NULL) por delante de su `billing` id=771 (11001),
          // así que el gate «detenía el deploy» por un municipio ausente que el
          // camino de emisión sí resuelve. Un gate que frena por la razón
          // equivocada acaba ignorado, y eso es peor que no tenerlo.
          organization: {
            include: {
              addresses: {
                where: { type: 'billing' },
                orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
                take: 1,
              },
              organization_settings: { select: { settings: true } },
            },
          },
          store: {
            include: {
              addresses: {
                where: { type: 'billing' },
                orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
                take: 1,
              },
              store_settings: { select: { settings: true } },
            },
          },
        },
      },
    },
  });

  console.log(`Tenants con DIAN activa: ${configs.length}`);

  const allDiffs: FieldDiff[] = [];

  for (const config of configs) {
    const entity = config.accounting_entity;
    if (!entity) continue;

    const org = entity.organization;
    const store = entity.store;
    const scope = entity.fiscal_scope;
    const address =
      scope === 'STORE' ? store?.addresses?.[0] : org?.addresses?.[0];

    const settings =
      scope === 'STORE'
        ? store?.store_settings?.settings
        : org?.organization_settings?.settings;
    const fiscalData = ((settings as any)?.fiscal_data ?? null) as
      | Record<string, unknown>
      | null;

    const legacy = legacyCascade({
      config: { nit: config.nit, nit_dv: config.nit_dv, name: null },
      entity: { legal_name: entity.legal_name, name: entity.name },
      organization: org
        ? {
            legal_name: org.legal_name,
            name: org.name,
            email: org.email,
            phone: org.phone,
            document_type: org.document_type,
            person_type: org.person_type,
          }
        : null,
      address: address
        ? {
            address_line1: address.address_line1,
            city: address.city,
            state_province: address.state_province,
            municipality_code: address.municipality_code,
            postal_code: address.postal_code,
            phone_number: address.phone_number,
            country_code: address.country_code,
          }
        : null,
      fiscalData,
    });

    let neu: DianIssuerData;
    try {
      neu = resolveIssuerFiscalIdentity({
        nit: config.nit,
        fiscal_data: fiscalData,
        entity: { legal_name: entity.legal_name, name: entity.name },
        organization: org
          ? {
              legal_name: org.legal_name,
              name: org.name,
              email: org.email,
              phone: org.phone,
              document_type: org.document_type,
              person_type: org.person_type,
            }
          : null,
        address: address
          ? {
              address_line1: address.address_line1,
              city: address.city,
              state_province: address.state_province,
              municipality_code: address.municipality_code,
              postal_code: address.postal_code,
              phone_number: address.phone_number,
            }
          : null,
        email: org?.email,
      });
    } catch (err) {
      allDiffs.push({
        tenant: `${scope}:${config.organization_id}:${config.store_id ?? 'null'}`,
        field: '(resolver)',
        old_value: 'OK',
        new_value: `THROW: ${(err as Error).message}`,
      });
      continue;
    }

    const tenantLabel = `${scope}:${config.organization_id}:${config.store_id ?? 'null'}`;
    allDiffs.push(...diff(legacy, neu, tenantLabel));
  }

  console.log('\nDiferencias detectadas:');
  console.log('-'.repeat(60));
  if (allDiffs.length === 0) {
    console.log('  (ninguna — el resolvedor produce la misma identidad que la cascada actual)');
  } else {
    for (const d of allDiffs) {
      console.log(
        `  ${d.tenant} field=${d.field}\n    old=${JSON.stringify(d.old_value)}\n    new=${JSON.stringify(d.new_value)}`,
      );
    }
  }

  console.log('-'.repeat(60));
  console.log(`Total: ${allDiffs.length}`);

  if (allDiffs.length === 0) {
    console.log('OK — deploy del paso 4 puede proceder.');
  } else {
    console.log('DEPLOY DETENIDO — diferencias detectadas, revisar antes de continuar.');
  }

  return { differences: allDiffs.length };
}

if (require.main === module) {
  runPreDeployGate()
    .then((r) => process.exit(r.differences > 0 ? 1 : 0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
