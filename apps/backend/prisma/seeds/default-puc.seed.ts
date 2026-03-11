import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedDefaultPucResult {
  accounts_created: number;
}

/**
 * DEPENDENCIES: Requires an organization to exist.
 *
 * Seeds the Colombian PUC (Plan Unico de Cuentas) chart of accounts
 * for a given organization. Uses upsert to be idempotent.
 *
 * @param organization_id - The organization to seed accounts for
 * @param prisma - Optional PrismaClient instance
 */
export async function seedDefaultPuc(
  organization_id: number,
  prisma?: PrismaClient,
): Promise<SeedDefaultPucResult> {
  const client = prisma || getPrismaClient();

  const accounts = getPucAccounts();
  let accounts_created = 0;

  for (const account of accounts) {
    // Resolve parent_id by looking up parent code
    let parent_id: number | null = null;
    if (account.parent_code) {
      const parent = await client.chart_of_accounts.findUnique({
        where: {
          organization_id_code: {
            organization_id,
            code: account.parent_code,
          },
        },
      });
      parent_id = parent?.id ?? null;
    }

    await client.chart_of_accounts.upsert({
      where: {
        organization_id_code: {
          organization_id,
          code: account.code,
        },
      },
      update: {
        name: account.name,
        account_type: account.account_type,
        nature: account.nature,
        parent_id,
        level: account.level,
        is_active: true,
        accepts_entries: account.accepts_entries,
      },
      create: {
        organization_id,
        code: account.code,
        name: account.name,
        account_type: account.account_type,
        nature: account.nature,
        parent_id,
        level: account.level,
        is_active: true,
        accepts_entries: account.accepts_entries,
      },
    });

    accounts_created++;
  }

  console.log(
    `[PUC Seed] Created/updated ${accounts_created} accounts for organization ${organization_id}`,
  );

  return { accounts_created };
}

interface PucAccountInput {
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  nature: 'debit' | 'credit';
  parent_code: string | null;
  level: number;
  accepts_entries: boolean;
}

function getPucAccounts(): PucAccountInput[] {
  return [
    // ===== LEVEL 1: CLASSES =====
    {
      code: '1',
      name: 'Activos',
      account_type: 'asset',
      nature: 'debit',
      parent_code: null,
      level: 1,
      accepts_entries: false,
    },
    {
      code: '2',
      name: 'Pasivos',
      account_type: 'liability',
      nature: 'credit',
      parent_code: null,
      level: 1,
      accepts_entries: false,
    },
    {
      code: '3',
      name: 'Patrimonio',
      account_type: 'equity',
      nature: 'credit',
      parent_code: null,
      level: 1,
      accepts_entries: false,
    },
    {
      code: '4',
      name: 'Ingresos',
      account_type: 'revenue',
      nature: 'credit',
      parent_code: null,
      level: 1,
      accepts_entries: false,
    },
    {
      code: '5',
      name: 'Gastos',
      account_type: 'expense',
      nature: 'debit',
      parent_code: null,
      level: 1,
      accepts_entries: false,
    },
    {
      code: '6',
      name: 'Costos de Venta',
      account_type: 'expense',
      nature: 'debit',
      parent_code: null,
      level: 1,
      accepts_entries: false,
    },

    // ===== LEVEL 2: GROUPS =====

    // Activos
    {
      code: '11',
      name: 'Disponible',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1',
      level: 2,
      accepts_entries: false,
    },
    {
      code: '13',
      name: 'Deudores',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1',
      level: 2,
      accepts_entries: false,
    },
    {
      code: '14',
      name: 'Inventarios',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1',
      level: 2,
      accepts_entries: false,
    },

    // Pasivos
    {
      code: '22',
      name: 'Proveedores',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2',
      level: 2,
      accepts_entries: false,
    },
    {
      code: '23',
      name: 'Cuentas por Pagar',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2',
      level: 2,
      accepts_entries: false,
    },
    {
      code: '24',
      name: 'Impuestos, Gravámenes y Tasas',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2',
      level: 2,
      accepts_entries: false,
    },
    {
      code: '25',
      name: 'Obligaciones Laborales',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2',
      level: 2,
      accepts_entries: false,
    },

    // Patrimonio
    {
      code: '31',
      name: 'Capital Social',
      account_type: 'equity',
      nature: 'credit',
      parent_code: '3',
      level: 2,
      accepts_entries: false,
    },
    {
      code: '36',
      name: 'Resultados del Ejercicio',
      account_type: 'equity',
      nature: 'credit',
      parent_code: '3',
      level: 2,
      accepts_entries: false,
    },

    // Ingresos
    {
      code: '41',
      name: 'Operacionales',
      account_type: 'revenue',
      nature: 'credit',
      parent_code: '4',
      level: 2,
      accepts_entries: false,
    },

    // Gastos
    {
      code: '51',
      name: 'Operacionales de Administración',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5',
      level: 2,
      accepts_entries: false,
    },
    {
      code: '52',
      name: 'Operacionales de Ventas',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5',
      level: 2,
      accepts_entries: false,
    },
    {
      code: '53',
      name: 'No Operacionales',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5',
      level: 2,
      accepts_entries: false,
    },

    // Costos de Venta
    {
      code: '61',
      name: 'Costo de Ventas y de Prestación de Servicios',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '6',
      level: 2,
      accepts_entries: false,
    },

    // ===== LEVEL 3: ACCOUNTS =====

    // Activos - Disponible
    {
      code: '1105',
      name: 'Caja',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '11',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '1110',
      name: 'Bancos',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '11',
      level: 3,
      accepts_entries: false,
    },

    // Activos - Deudores
    {
      code: '1305',
      name: 'Clientes',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '13',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '1355',
      name: 'Anticipos y Avances',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '13',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '1380',
      name: 'Deudores Varios',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '13',
      level: 3,
      accepts_entries: false,
    },

    // Activos - Inventarios
    {
      code: '1435',
      name: 'Mercancías no Fabricadas por la Empresa',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '14',
      level: 3,
      accepts_entries: false,
    },

    // Pasivos - Proveedores
    {
      code: '2205',
      name: 'Proveedores Nacionales',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '22',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '2210',
      name: 'Proveedores del Exterior',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '22',
      level: 3,
      accepts_entries: false,
    },

    // Pasivos - Cuentas por Pagar
    {
      code: '2335',
      name: 'Costos y Gastos por Pagar',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '23',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '2365',
      name: 'Retención en la Fuente',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '23',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '2370',
      name: 'Retenciones y Aportes de Nómina',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '23',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '2380',
      name: 'Acreedores Varios',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '23',
      level: 3,
      accepts_entries: false,
    },

    // Pasivos - Impuestos
    {
      code: '2408',
      name: 'Impuesto sobre las Ventas por Pagar (IVA)',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '24',
      level: 3,
      accepts_entries: false,
    },

    // Pasivos - Obligaciones Laborales
    {
      code: '2505',
      name: 'Salarios por Pagar',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '25',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '2510',
      name: 'Cesantías Consolidadas',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '25',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '2515',
      name: 'Intereses sobre Cesantías',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '25',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '2520',
      name: 'Prima de Servicios',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '25',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '2525',
      name: 'Vacaciones Consolidadas',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '25',
      level: 3,
      accepts_entries: false,
    },

    // Patrimonio - Capital Social
    {
      code: '3105',
      name: 'Capital Suscrito y Pagado',
      account_type: 'equity',
      nature: 'credit',
      parent_code: '31',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '3115',
      name: 'Aportes Sociales',
      account_type: 'equity',
      nature: 'credit',
      parent_code: '31',
      level: 3,
      accepts_entries: false,
    },

    // Patrimonio - Resultados
    {
      code: '3605',
      name: 'Utilidad del Ejercicio',
      account_type: 'equity',
      nature: 'credit',
      parent_code: '36',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '3610',
      name: 'Pérdida del Ejercicio',
      account_type: 'equity',
      nature: 'debit',
      parent_code: '36',
      level: 3,
      accepts_entries: false,
    },

    // Ingresos - Operacionales
    {
      code: '4135',
      name: 'Comercio al por Mayor y al por Menor',
      account_type: 'revenue',
      nature: 'credit',
      parent_code: '41',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '4175',
      name: 'Devoluciones en Ventas (DB)',
      account_type: 'revenue',
      nature: 'debit',
      parent_code: '41',
      level: 3,
      accepts_entries: false,
    },

    // Gastos - Operacionales de Administración
    {
      code: '5105',
      name: 'Gastos de Personal',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '51',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '5110',
      name: 'Honorarios',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '51',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '5135',
      name: 'Servicios',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '51',
      level: 3,
      accepts_entries: false,
    },
    {
      code: '5195',
      name: 'Diversos',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '51',
      level: 3,
      accepts_entries: false,
    },

    // Gastos - No Operacionales
    {
      code: '5305',
      name: 'Gastos Financieros',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '53',
      level: 3,
      accepts_entries: false,
    },

    // Costos de Venta
    {
      code: '6135',
      name: 'Comercio al por Mayor y al por Menor',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '61',
      level: 3,
      accepts_entries: false,
    },

    // ===== LEVEL 4: SUB-ACCOUNTS (accepts entries) =====

    // Caja
    {
      code: '110505',
      name: 'Caja General',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '110510',
      name: 'Cajas Menores',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1105',
      level: 4,
      accepts_entries: true,
    },

    // Bancos
    {
      code: '111005',
      name: 'Moneda Nacional',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1110',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '111010',
      name: 'Moneda Extranjera',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1110',
      level: 4,
      accepts_entries: true,
    },

    // Clientes
    {
      code: '130505',
      name: 'Clientes Nacionales',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1305',
      level: 4,
      accepts_entries: true,
    },

    // Inventarios
    {
      code: '143505',
      name: 'Mercancías en Existencia',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1435',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '143510',
      name: 'Mercancías en Tránsito',
      account_type: 'asset',
      nature: 'debit',
      parent_code: '1435',
      level: 4,
      accepts_entries: true,
    },

    // Proveedores
    {
      code: '220505',
      name: 'Proveedores Nacionales',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2205',
      level: 4,
      accepts_entries: true,
    },

    // Costos y Gastos por Pagar
    {
      code: '233505',
      name: 'Gastos Acumulados por Pagar',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2335',
      level: 4,
      accepts_entries: true,
    },

    // Retención en la Fuente
    {
      code: '236505',
      name: 'Retención en la Fuente Salarios',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2365',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '236525',
      name: 'Retención en la Fuente Compras',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2365',
      level: 4,
      accepts_entries: true,
    },

    // Retenciones y Aportes de Nómina
    {
      code: '237005',
      name: 'Aportes EPS',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2370',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '237006',
      name: 'Aportes ARL',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2370',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '237010',
      name: 'Aportes Pensión',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2370',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '237025',
      name: 'Aportes Caja de Compensación',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2370',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '237030',
      name: 'Aportes ICBF',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2370',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '237035',
      name: 'Aportes SENA',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2370',
      level: 4,
      accepts_entries: true,
    },

    // IVA
    {
      code: '240802',
      name: 'IVA Generado por Ventas',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2408',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '240804',
      name: 'IVA Descontable en Compras',
      account_type: 'liability',
      nature: 'debit',
      parent_code: '2408',
      level: 4,
      accepts_entries: true,
    },

    // Salarios por Pagar
    {
      code: '250505',
      name: 'Salarios por Pagar',
      account_type: 'liability',
      nature: 'credit',
      parent_code: '2505',
      level: 4,
      accepts_entries: true,
    },

    // Capital
    {
      code: '310505',
      name: 'Capital Autorizado',
      account_type: 'equity',
      nature: 'credit',
      parent_code: '3105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '311505',
      name: 'Aportes de Socios',
      account_type: 'equity',
      nature: 'credit',
      parent_code: '3115',
      level: 4,
      accepts_entries: true,
    },

    // Resultados
    {
      code: '360505',
      name: 'Utilidad del Ejercicio',
      account_type: 'equity',
      nature: 'credit',
      parent_code: '3605',
      level: 4,
      accepts_entries: true,
    },

    // Ingresos Operacionales
    {
      code: '413505',
      name: 'Venta de Mercancías',
      account_type: 'revenue',
      nature: 'credit',
      parent_code: '4135',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '417505',
      name: 'Devoluciones en Ventas',
      account_type: 'revenue',
      nature: 'debit',
      parent_code: '4175',
      level: 4,
      accepts_entries: true,
    },

    // Gastos de Personal
    {
      code: '510506',
      name: 'Sueldos',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510515',
      name: 'Horas Extras y Recargos',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510527',
      name: 'Auxilio de Transporte',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510530',
      name: 'Cesantías',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510533',
      name: 'Intereses sobre Cesantías',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510536',
      name: 'Prima de Servicios',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510539',
      name: 'Vacaciones',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510568',
      name: 'Aportes a EPS',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510569',
      name: 'Aportes a Pensión',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510570',
      name: 'Aportes a ARL',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510572',
      name: 'Aportes a Caja de Compensación',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510575',
      name: 'Aportes ICBF',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '510578',
      name: 'Aportes SENA',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5105',
      level: 4,
      accepts_entries: true,
    },

    // Honorarios
    {
      code: '511005',
      name: 'Honorarios - Junta Directiva',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5110',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '511010',
      name: 'Honorarios - Revisoría Fiscal',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5110',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '511015',
      name: 'Honorarios - Asesoría Jurídica',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5110',
      level: 4,
      accepts_entries: true,
    },

    // Servicios
    {
      code: '513505',
      name: 'Aseo y Vigilancia',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5135',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '513525',
      name: 'Acueducto y Alcantarillado',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5135',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '513530',
      name: 'Energía Eléctrica',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5135',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '513535',
      name: 'Teléfono e Internet',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5135',
      level: 4,
      accepts_entries: true,
    },

    // Diversos
    {
      code: '519505',
      name: 'Elementos de Aseo y Cafetería',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5195',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '519510',
      name: 'Útiles, Papelería y Fotocopias',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5195',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '519530',
      name: 'Gastos de Representación',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5195',
      level: 4,
      accepts_entries: true,
    },

    // Gastos Financieros
    {
      code: '530505',
      name: 'Gastos Bancarios',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5305',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '530515',
      name: 'Comisiones',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5305',
      level: 4,
      accepts_entries: true,
    },
    {
      code: '530520',
      name: 'Intereses',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '5305',
      level: 4,
      accepts_entries: true,
    },

    // Costos de Venta
    {
      code: '613505',
      name: 'Costo de Mercancías Vendidas',
      account_type: 'expense',
      nature: 'debit',
      parent_code: '6135',
      level: 4,
      accepts_entries: true,
    },
  ];
}
