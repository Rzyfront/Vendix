import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

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
 * Uses upsert to be idempotent.
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

  const accounting_entities = await client.accounting_entities.findMany({
    where: { organization_id, is_active: true },
    select: { id: true },
  });
  const accounting_entity_ids = accounting_entities.length
    ? accounting_entities.map((entity) => entity.id)
    : [null];

  for (const accounting_entity_id of accounting_entity_ids) {
    for (const account of accounts) {
      // Resolve parent_id by looking up parent code inside the same accounting entity.
      let parent_id: number | null = null;
      if (account.parent_code) {
        const parent = await client.chart_of_accounts.findFirst({
          where: {
            organization_id,
            accounting_entity_id,
            code: account.parent_code,
          },
        });
        parent_id = parent?.id ?? null;
      }

      const existing = await client.chart_of_accounts.findFirst({
        where: {
          organization_id,
          accounting_entity_id,
          code: account.code,
        },
      });

      if (existing) {
        await client.chart_of_accounts.update({
          where: { id: existing.id },
          data: {
            name: account.name,
            account_type: account.account_type,
            nature: account.nature,
            parent_id,
            level: account.level,
            is_active: true,
            accepts_entries: account.accepts_entries,
          },
        });
      } else {
        await client.chart_of_accounts.create({
          data: {
            organization_id,
            accounting_entity_id,
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

interface PucAccountInput {
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  nature: 'debit' | 'credit';
  parent_code: string | null;
  level: number;
  accepts_entries: boolean;
}

/**
 * PUC Completo para SGE — Decreto 2650/1993 + Resolución 040/2023
 *
 * Hierarchy:
 *   Level 1 = Clase       (1 digit:  1, 2, 3...)
 *   Level 2 = Grupo       (2 digits: 11, 12, 13...)
 *   Level 3 = Cuenta      (4 digits: 1105, 1110...)
 *   Level 4 = Subcuenta   (6 digits: 110505, 110510...)
 *
 * Only level-4 accounts have accepts_entries = true.
 */
function getPucAccounts(): PucAccountInput[] {
  // Helper to reduce boilerplate
  const a = (
    code: string,
    name: string,
    account_type: PucAccountInput['account_type'],
    nature: PucAccountInput['nature'],
    parent_code: string | null,
  ): PucAccountInput => ({
    code,
    name,
    account_type,
    nature,
    parent_code,
    level: code.length <= 1 ? 1 : code.length <= 2 ? 2 : code.length <= 4 ? 3 : 4,
    accepts_entries: code.length >= 6,
  });

  return [
    // ╔══════════════════════════════════════════════════════════════╗
    // ║  CLASE 1 — ACTIVOS                                          ║
    // ╚══════════════════════════════════════════════════════════════╝
    a('1', 'Activos', 'asset', 'debit', null),

    // ── Grupo 11: Disponible ──
    a('11', 'Disponible', 'asset', 'debit', '1'),
    a('1105', 'Caja', 'asset', 'debit', '11'),
    a('110505', 'Caja General', 'asset', 'debit', '1105'),
    a('110510', 'Cajas Menores', 'asset', 'debit', '1105'),
    a('110515', 'Moneda Extranjera', 'asset', 'debit', '1105'),
    a('1110', 'Bancos', 'asset', 'debit', '11'),
    a('111005', 'Moneda Nacional', 'asset', 'debit', '1110'),
    a('111010', 'Moneda Extranjera', 'asset', 'debit', '1110'),
    a('1120', 'Cuentas de Ahorro', 'asset', 'debit', '11'),
    a('112005', 'Cuentas de Ahorro Nacionales', 'asset', 'debit', '1120'),

    // ── Grupo 12: Inversiones ──
    a('12', 'Inversiones', 'asset', 'debit', '1'),
    a('1205', 'Acciones', 'asset', 'debit', '12'),
    a('120505', 'Acciones en Sociedades', 'asset', 'debit', '1205'),
    a('1210', 'Cuotas o Partes de Interés Social', 'asset', 'debit', '12'),
    a('121005', 'Cuotas o Partes de Interés Social', 'asset', 'debit', '1210'),
    a('1225', 'Certificados', 'asset', 'debit', '12'),
    a('122505', 'Certificados de Depósito a Término (CDT)', 'asset', 'debit', '1225'),

    // ── Grupo 13: Deudores ──
    a('13', 'Deudores', 'asset', 'debit', '1'),
    a('1305', 'Clientes', 'asset', 'debit', '13'),
    a('130505', 'Clientes Nacionales', 'asset', 'debit', '1305'),
    a('130510', 'Clientes del Exterior', 'asset', 'debit', '1305'),
    a('1310', 'Cuentas Corrientes Comerciales', 'asset', 'debit', '13'),
    a('131005', 'Cuentas Corrientes Comerciales', 'asset', 'debit', '1310'),
    a('1325', 'Cuentas por Cobrar a Socios y Accionistas', 'asset', 'debit', '13'),
    a('132505', 'A Socios', 'asset', 'debit', '1325'),
    a('1330', 'Anticipos y Avances', 'asset', 'debit', '13'),
    a('133005', 'A Proveedores', 'asset', 'debit', '1330'),
    a('133010', 'A Contratistas', 'asset', 'debit', '1330'),
    a('133015', 'A Trabajadores', 'asset', 'debit', '1330'),
    a('1345', 'Ingresos por Cobrar', 'asset', 'debit', '13'),
    a('134505', 'Dividendos y Participaciones', 'asset', 'debit', '1345'),
    a('134510', 'Intereses', 'asset', 'debit', '1345'),
    a('1355', 'Anticipos de Impuestos y Contribuciones', 'asset', 'debit', '13'),
    a('135505', 'Anticipo de Renta', 'asset', 'debit', '1355'),
    a('135510', 'Retención en la Fuente a Favor', 'asset', 'debit', '1355'),
    a('135515', 'IVA Retenido', 'asset', 'debit', '1355'),
    a('135517', 'ICA Retenido', 'asset', 'debit', '1355'),
    a('1360', 'Reclamaciones', 'asset', 'debit', '13'),
    a('136005', 'A Compañías Aseguradoras', 'asset', 'debit', '1360'),
    a('1365', 'Cuentas por Cobrar a Trabajadores', 'asset', 'debit', '13'),
    a('136505', 'Préstamos a Empleados', 'asset', 'debit', '1365'),
    a('1380', 'Deudores Varios', 'asset', 'debit', '13'),
    a('138005', 'Deudores Varios', 'asset', 'debit', '1380'),
    a('1390', 'Deudas de Difícil Cobro', 'asset', 'debit', '13'),
    a('139005', 'Deudas de Difícil Cobro', 'asset', 'debit', '1390'),
    a('1399', 'Provisiones (CR)', 'asset', 'credit', '13'),
    a('139905', 'Provisión Clientes', 'asset', 'credit', '1399'),

    // ── Grupo 14: Inventarios ──
    a('14', 'Inventarios', 'asset', 'debit', '1'),
    a('1405', 'Materias Primas', 'asset', 'debit', '14'),
    a('140505', 'Materias Primas', 'asset', 'debit', '1405'),
    a('1410', 'Productos en Proceso', 'asset', 'debit', '14'),
    a('141005', 'Productos en Proceso', 'asset', 'debit', '1410'),
    a('1430', 'Productos Terminados', 'asset', 'debit', '14'),
    a('143005', 'Productos Terminados', 'asset', 'debit', '1430'),
    a('1435', 'Mercancías no Fabricadas por la Empresa', 'asset', 'debit', '14'),
    a('143505', 'Mercancías en Existencia', 'asset', 'debit', '1435'),
    a('143510', 'Mercancías en Tránsito', 'asset', 'debit', '1435'),
    a('1440', 'Bienes Raíces para la Venta', 'asset', 'debit', '14'),
    a('144005', 'Bienes Raíces para la Venta', 'asset', 'debit', '1440'),
    a('1450', 'Anticipos y Avances a Empleados', 'asset', 'debit', '14'),
    a('145005', 'Anticipos y Avances a Empleados', 'asset', 'debit', '1450'),
    a('1455', 'Materiales, Repuestos y Accesorios', 'asset', 'debit', '14'),
    a('145505', 'Materiales, Repuestos y Accesorios', 'asset', 'debit', '1455'),
    a('1465', 'Inventarios en Tránsito', 'asset', 'debit', '14'),
    a('146505', 'Inventarios en Tránsito', 'asset', 'debit', '1465'),
    a('1499', 'Provisiones (CR)', 'asset', 'credit', '14'),
    a('149905', 'Provisión para Obsolescencia', 'asset', 'credit', '1499'),

    // ── Grupo 15: Propiedad, Planta y Equipo ──
    a('15', 'Propiedad, Planta y Equipo', 'asset', 'debit', '1'),
    a('1504', 'Terrenos', 'asset', 'debit', '15'),
    a('150405', 'Terrenos Urbanos', 'asset', 'debit', '1504'),
    a('150410', 'Terrenos Rurales', 'asset', 'debit', '1504'),
    a('1508', 'Construcciones en Curso', 'asset', 'debit', '15'),
    a('150805', 'Construcciones y Edificaciones en Curso', 'asset', 'debit', '1508'),
    a('1516', 'Construcciones y Edificaciones', 'asset', 'debit', '15'),
    a('151605', 'Edificios', 'asset', 'debit', '1516'),
    a('151610', 'Oficinas', 'asset', 'debit', '1516'),
    a('151615', 'Locales', 'asset', 'debit', '1516'),
    a('151620', 'Bodegas', 'asset', 'debit', '1516'),
    a('1520', 'Maquinaria y Equipo', 'asset', 'debit', '15'),
    a('152005', 'Maquinaria y Equipo Industrial', 'asset', 'debit', '1520'),
    a('1524', 'Equipo de Oficina', 'asset', 'debit', '15'),
    a('152405', 'Muebles y Enseres', 'asset', 'debit', '1524'),
    a('152410', 'Equipos', 'asset', 'debit', '1524'),
    a('1528', 'Equipo de Computación y Comunicación', 'asset', 'debit', '15'),
    a('152805', 'Equipos de Procesamiento de Datos', 'asset', 'debit', '1528'),
    a('152810', 'Equipos de Telecomunicaciones', 'asset', 'debit', '1528'),
    a('1540', 'Flota y Equipo de Transporte', 'asset', 'debit', '15'),
    a('154005', 'Autos, Camionetas y Camperos', 'asset', 'debit', '1540'),
    a('154010', 'Camiones, Volquetas y Furgones', 'asset', 'debit', '1540'),
    a('154015', 'Motocicletas', 'asset', 'debit', '1540'),
    a('1592', 'Depreciación Acumulada (CR)', 'asset', 'credit', '15'),
    a('159205', 'Construcciones y Edificaciones', 'asset', 'credit', '1592'),
    a('159210', 'Maquinaria y Equipo', 'asset', 'credit', '1592'),
    a('159215', 'Equipo de Oficina', 'asset', 'credit', '1592'),
    a('159220', 'Equipo de Computación', 'asset', 'credit', '1592'),
    a('159235', 'Flota y Equipo de Transporte', 'asset', 'credit', '1592'),

    // ── Grupo 16: Intangibles ──
    a('16', 'Intangibles', 'asset', 'debit', '1'),
    a('1605', 'Crédito Mercantil', 'asset', 'debit', '16'),
    a('160505', 'Crédito Mercantil Formado', 'asset', 'debit', '1605'),
    a('1610', 'Marcas', 'asset', 'debit', '16'),
    a('161005', 'Marcas Adquiridas', 'asset', 'debit', '1610'),
    a('1615', 'Patentes', 'asset', 'debit', '16'),
    a('161505', 'Patentes Industriales', 'asset', 'debit', '1615'),
    a('1620', 'Concesiones y Franquicias', 'asset', 'debit', '16'),
    a('162005', 'Concesiones', 'asset', 'debit', '1620'),
    a('162010', 'Franquicias', 'asset', 'debit', '1620'),
    a('1635', 'Licencias', 'asset', 'debit', '16'),
    a('163505', 'Licencias de Software', 'asset', 'debit', '1635'),
    a('1698', 'Amortización Acumulada (CR)', 'asset', 'credit', '16'),
    a('169805', 'Amortización Acumulada', 'asset', 'credit', '1698'),

    // ── Grupo 17: Diferidos ──
    a('17', 'Diferidos', 'asset', 'debit', '1'),
    a('1705', 'Gastos Pagados por Anticipado', 'asset', 'debit', '17'),
    a('170505', 'Seguros y Fianzas', 'asset', 'debit', '1705'),
    a('170510', 'Arrendamientos', 'asset', 'debit', '1705'),
    a('170515', 'Intereses Pagados por Anticipado', 'asset', 'debit', '1705'),
    a('1710', 'Cargos Diferidos', 'asset', 'debit', '17'),
    a('171004', 'Organización y Preoperativos', 'asset', 'debit', '1710'),
    a('171012', 'Programas para Computador (Software)', 'asset', 'debit', '1710'),
    a('171016', 'Publicidad y Propaganda', 'asset', 'debit', '1710'),

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  CLASE 2 — PASIVOS                                          ║
    // ╚══════════════════════════════════════════════════════════════╝
    a('2', 'Pasivos', 'liability', 'credit', null),

    // ── Grupo 21: Obligaciones Financieras ──
    a('21', 'Obligaciones Financieras', 'liability', 'credit', '2'),
    a('2105', 'Bancos Nacionales', 'liability', 'credit', '21'),
    a('210505', 'Sobregiros', 'liability', 'credit', '2105'),
    a('210510', 'Pagarés', 'liability', 'credit', '2105'),
    a('210515', 'Cartas de Crédito', 'liability', 'credit', '2105'),
    a('2110', 'Bancos del Exterior', 'liability', 'credit', '21'),
    a('211005', 'Créditos del Exterior', 'liability', 'credit', '2110'),
    a('2120', 'Compañías de Financiamiento Comercial', 'liability', 'credit', '21'),
    a('212005', 'Pagarés Financiamiento', 'liability', 'credit', '2120'),

    // ── Grupo 22: Proveedores ──
    a('22', 'Proveedores', 'liability', 'credit', '2'),
    a('2205', 'Proveedores Nacionales', 'liability', 'credit', '22'),
    a('220505', 'Proveedores Nacionales', 'liability', 'credit', '2205'),
    a('2210', 'Proveedores del Exterior', 'liability', 'credit', '22'),
    a('221005', 'Proveedores del Exterior', 'liability', 'credit', '2210'),
    a('2215', 'Cuentas por Pagar a Casa Matriz', 'liability', 'credit', '22'),
    a('221505', 'Cuentas por Pagar a Casa Matriz', 'liability', 'credit', '2215'),

    // ── Grupo 23: Cuentas por Pagar ──
    a('23', 'Cuentas por Pagar', 'liability', 'credit', '2'),
    a('2305', 'Cuentas Corrientes Comerciales', 'liability', 'credit', '23'),
    a('230505', 'Cuentas Corrientes Comerciales', 'liability', 'credit', '2305'),
    a('2310', 'A Casa Matriz', 'liability', 'credit', '23'),
    a('231005', 'A Casa Matriz', 'liability', 'credit', '2310'),
    a('2315', 'A Compañías Vinculadas', 'liability', 'credit', '23'),
    a('231505', 'A Compañías Vinculadas', 'liability', 'credit', '2315'),
    a('2320', 'A Contratistas', 'liability', 'credit', '23'),
    a('232005', 'A Contratistas', 'liability', 'credit', '2320'),
    a('2335', 'Costos y Gastos por Pagar', 'liability', 'credit', '23'),
    a('233505', 'Gastos Financieros por Pagar', 'liability', 'credit', '2335'),
    a('233510', 'Gastos Legales por Pagar', 'liability', 'credit', '2335'),
    a('233525', 'Servicios Públicos por Pagar', 'liability', 'credit', '2335'),
    a('233530', 'Arrendamientos por Pagar', 'liability', 'credit', '2335'),
    a('2340', 'Instalamentos por Pagar', 'liability', 'credit', '23'),
    a('234005', 'Instalamentos por Pagar', 'liability', 'credit', '2340'),
    a('2355', 'Deudas con Accionistas o Socios', 'liability', 'credit', '23'),
    a('235505', 'Accionistas', 'liability', 'credit', '2355'),
    a('235510', 'Socios', 'liability', 'credit', '2355'),
    a('2360', 'Dividendos o Participaciones por Pagar', 'liability', 'credit', '23'),
    a('236005', 'Dividendos por Pagar', 'liability', 'credit', '2360'),
    a('2365', 'Retención en la Fuente', 'liability', 'credit', '23'),
    a('236505', 'Salarios y Pagos Laborales', 'liability', 'credit', '2365'),
    a('236510', 'Dividendos y Participaciones', 'liability', 'credit', '2365'),
    a('236515', 'Honorarios', 'liability', 'credit', '2365'),
    a('236520', 'Servicios', 'liability', 'credit', '2365'),
    a('236525', 'Compras', 'liability', 'credit', '2365'),
    a('236530', 'Arrendamientos', 'liability', 'credit', '2365'),
    a('236540', 'Rendimientos Financieros', 'liability', 'credit', '2365'),
    a('236570', 'Otras Retenciones', 'liability', 'credit', '2365'),
    a('2367', 'Impuesto a las Ventas Retenido', 'liability', 'credit', '23'),
    a('236705', 'IVA Retenido por Pagar', 'liability', 'credit', '2367'),
    a('2368', 'Impuesto de Industria y Comercio Retenido', 'liability', 'credit', '23'),
    a('236805', 'ICA Retenido por Pagar', 'liability', 'credit', '2368'),
    a('2370', 'Retenciones y Aportes de Nómina', 'liability', 'credit', '23'),
    a('237005', 'Aportes EPS', 'liability', 'credit', '2370'),
    a('237006', 'Aportes ARL', 'liability', 'credit', '2370'),
    a('237010', 'Aportes Pensión', 'liability', 'credit', '2370'),
    a('237025', 'Aportes Caja de Compensación', 'liability', 'credit', '2370'),
    a('237030', 'Aportes ICBF', 'liability', 'credit', '2370'),
    a('237035', 'Aportes SENA', 'liability', 'credit', '2370'),
    a('237040', 'Fondo de Solidaridad Pensional', 'liability', 'credit', '2370'),
    a('237045', 'Sindicatos', 'liability', 'credit', '2370'),
    a('237050', 'Cooperativas', 'liability', 'credit', '2370'),
    a('237055', 'Embargos Judiciales', 'liability', 'credit', '2370'),
    a('2380', 'Acreedores Varios', 'liability', 'credit', '23'),
    a('238005', 'Acreedores Varios', 'liability', 'credit', '2380'),

    // ── Grupo 24: Impuestos, Gravámenes y Tasas ──
    a('24', 'Impuestos, Gravámenes y Tasas', 'liability', 'credit', '2'),
    a('2404', 'Impuesto de Renta y Complementarios', 'liability', 'credit', '24'),
    a('240405', 'Impuesto de Renta - Vigencia Fiscal Corriente', 'liability', 'credit', '2404'),
    a('240410', 'Impuesto de Renta - Vigencias Anteriores', 'liability', 'credit', '2404'),
    a('2408', 'Impuesto sobre las Ventas por Pagar (IVA)', 'liability', 'credit', '24'),
    a('240802', 'IVA Generado por Ventas', 'liability', 'credit', '2408'),
    a('240804', 'IVA Descontable en Compras', 'liability', 'debit', '2408'),
    a('2412', 'Impuesto de Industria y Comercio (ICA)', 'liability', 'credit', '24'),
    a('241205', 'ICA por Pagar - Vigencia Corriente', 'liability', 'credit', '2412'),
    a('2416', 'Impuesto a la Riqueza', 'liability', 'credit', '24'),
    a('241605', 'Impuesto a la Riqueza', 'liability', 'credit', '2416'),
    a('2424', 'Impuesto de Timbre', 'liability', 'credit', '24'),
    a('242405', 'Impuesto de Timbre', 'liability', 'credit', '2424'),
    a('2436', 'Impuesto al Consumo', 'liability', 'credit', '24'),
    a('243605', 'Impuesto al Consumo', 'liability', 'credit', '2436'),

    // ── Grupo 25: Obligaciones Laborales ──
    a('25', 'Obligaciones Laborales', 'liability', 'credit', '2'),
    a('2505', 'Salarios por Pagar', 'liability', 'credit', '25'),
    a('250505', 'Salarios por Pagar', 'liability', 'credit', '2505'),
    a('2510', 'Cesantías Consolidadas', 'liability', 'credit', '25'),
    a('251005', 'Cesantías Ley 50 de 1990', 'liability', 'credit', '2510'),
    a('251010', 'Cesantías Retroactivas', 'liability', 'credit', '2510'),
    a('2515', 'Intereses sobre Cesantías', 'liability', 'credit', '25'),
    a('251505', 'Intereses sobre Cesantías', 'liability', 'credit', '2515'),
    a('2520', 'Prima de Servicios', 'liability', 'credit', '25'),
    a('252005', 'Prima de Servicios', 'liability', 'credit', '2520'),
    a('2525', 'Vacaciones Consolidadas', 'liability', 'credit', '25'),
    a('252505', 'Vacaciones Consolidadas', 'liability', 'credit', '2525'),
    a('2530', 'Prestaciones Extralegales', 'liability', 'credit', '25'),
    a('253005', 'Primas Extralegales', 'liability', 'credit', '2530'),
    a('253010', 'Auxilios', 'liability', 'credit', '2530'),
    a('2532', 'Pensiones por Pagar', 'liability', 'credit', '25'),
    a('253205', 'Pensiones de Jubilación', 'liability', 'credit', '2532'),
    a('2570', 'Pasivos Estimados y Provisiones', 'liability', 'credit', '25'),
    a('257005', 'Para Obligaciones Laborales', 'liability', 'credit', '2570'),

    // ── Grupo 26: Pasivos Estimados y Provisiones ──
    a('26', 'Pasivos Estimados y Provisiones', 'liability', 'credit', '2'),
    a('2605', 'Para Costos y Gastos', 'liability', 'credit', '26'),
    a('260505', 'Provisión para Costos y Gastos', 'liability', 'credit', '2605'),
    a('2610', 'Para Obligaciones Laborales', 'liability', 'credit', '26'),
    a('261005', 'Provisión para Obligaciones Laborales', 'liability', 'credit', '2610'),
    a('2615', 'Para Obligaciones Fiscales', 'liability', 'credit', '26'),
    a('261505', 'Provisión para Impuesto de Renta', 'liability', 'credit', '2615'),
    a('2620', 'Pensiones de Jubilación', 'liability', 'credit', '26'),
    a('262005', 'Pensiones de Jubilación', 'liability', 'credit', '2620'),
    a('2625', 'Prima de Servicios por Pagar', 'liability', 'credit', '26'),
    a('262505', 'Prima de Servicios por Pagar', 'liability', 'credit', '2625'),

    // ── Grupo 27: Diferidos ──
    a('27', 'Diferidos', 'liability', 'credit', '2'),
    a('2705', 'Ingresos Recibidos por Anticipado', 'liability', 'credit', '27'),
    a('270505', 'Anticipos de Clientes', 'liability', 'credit', '2705'),
    a('270510', 'Arrendamientos Recibidos por Anticipado', 'liability', 'credit', '2705'),
    a('270515', 'Intereses Recibidos por Anticipado', 'liability', 'credit', '2705'),
    a('2725', 'Abonos Diferidos', 'liability', 'credit', '27'),
    a('272505', 'Abonos Diferidos', 'liability', 'credit', '2725'),

    // ── Grupo 28: Otros Pasivos ──
    a('28', 'Otros Pasivos', 'liability', 'credit', '2'),
    a('2805', 'Anticipos y Avances Recibidos', 'liability', 'credit', '28'),
    a('280505', 'Anticipos de Clientes', 'liability', 'credit', '2805'),
    a('2815', 'Ingresos Recibidos para Terceros', 'liability', 'credit', '28'),
    a('281505', 'Remanentes', 'liability', 'credit', '2815'),
    a('2895', 'Diversos', 'liability', 'credit', '28'),
    a('289505', 'Otros Pasivos Diversos', 'liability', 'credit', '2895'),

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  CLASE 3 — PATRIMONIO                                       ║
    // ╚══════════════════════════════════════════════════════════════╝
    a('3', 'Patrimonio', 'equity', 'credit', null),

    // ── Grupo 31: Capital Social ──
    a('31', 'Capital Social', 'equity', 'credit', '3'),
    a('3105', 'Capital Suscrito y Pagado', 'equity', 'credit', '31'),
    a('310505', 'Capital Autorizado', 'equity', 'credit', '3105'),
    a('310510', 'Capital por Suscribir (DB)', 'equity', 'debit', '3105'),
    a('3115', 'Aportes Sociales', 'equity', 'credit', '31'),
    a('311505', 'Cuotas o Partes de Interés Social', 'equity', 'credit', '3115'),
    a('3120', 'Capital Asignado', 'equity', 'credit', '31'),
    a('312005', 'Capital Asignado', 'equity', 'credit', '3120'),
    a('3130', 'Capital de Personas Naturales', 'equity', 'credit', '31'),
    a('313005', 'Aportes del Propietario', 'equity', 'credit', '3130'),

    // ── Grupo 32: Superávit de Capital ──
    a('32', 'Superávit de Capital', 'equity', 'credit', '3'),
    a('3205', 'Prima en Colocación de Acciones', 'equity', 'credit', '32'),
    a('320505', 'Prima en Colocación', 'equity', 'credit', '3205'),
    a('3210', 'Donaciones', 'equity', 'credit', '32'),
    a('321005', 'Donaciones', 'equity', 'credit', '3210'),
    a('3215', 'Crédito Mercantil', 'equity', 'credit', '32'),
    a('321505', 'Crédito Mercantil', 'equity', 'credit', '3215'),

    // ── Grupo 33: Reservas ──
    a('33', 'Reservas', 'equity', 'credit', '3'),
    a('3305', 'Reservas Obligatorias', 'equity', 'credit', '33'),
    a('330505', 'Reserva Legal', 'equity', 'credit', '3305'),
    a('3310', 'Reservas Estatutarias', 'equity', 'credit', '33'),
    a('331005', 'Para Futuras Capitalizaciones', 'equity', 'credit', '3310'),
    a('3315', 'Reservas Ocasionales', 'equity', 'credit', '33'),
    a('331505', 'Para Futuros Ensanches', 'equity', 'credit', '3315'),

    // ── Grupo 34: Revalorización del Patrimonio ──
    a('34', 'Revalorización del Patrimonio', 'equity', 'credit', '3'),
    a('3405', 'Ajustes por Inflación', 'equity', 'credit', '34'),
    a('340505', 'Revalorización del Patrimonio', 'equity', 'credit', '3405'),

    // ── Grupo 35: Dividendos o Participaciones Decretados ──
    a('35', 'Dividendos Decretados en Acciones', 'equity', 'credit', '3'),
    a('3505', 'Dividendos Decretados en Acciones', 'equity', 'credit', '35'),
    a('350505', 'Dividendos Decretados', 'equity', 'credit', '3505'),

    // ── Grupo 36: Resultados del Ejercicio ──
    a('36', 'Resultados del Ejercicio', 'equity', 'credit', '3'),
    a('3605', 'Utilidad del Ejercicio', 'equity', 'credit', '36'),
    a('360505', 'Utilidad del Ejercicio', 'equity', 'credit', '3605'),
    a('3610', 'Pérdida del Ejercicio', 'equity', 'debit', '36'),
    a('361005', 'Pérdida del Ejercicio', 'equity', 'debit', '3610'),

    // ── Grupo 37: Resultados de Ejercicios Anteriores ──
    a('37', 'Resultados de Ejercicios Anteriores', 'equity', 'credit', '3'),
    a('3705', 'Utilidades Acumuladas', 'equity', 'credit', '37'),
    a('370505', 'Utilidades Acumuladas', 'equity', 'credit', '3705'),
    a('3710', 'Pérdidas Acumuladas', 'equity', 'debit', '37'),
    a('371005', 'Pérdidas Acumuladas', 'equity', 'debit', '3710'),

    // ── Grupo 38: Superávit por Valorizaciones ──
    a('38', 'Superávit por Valorizaciones', 'equity', 'credit', '3'),
    a('3805', 'De Inversiones', 'equity', 'credit', '38'),
    a('380505', 'De Inversiones', 'equity', 'credit', '3805'),
    a('3810', 'De Propiedad, Planta y Equipo', 'equity', 'credit', '38'),
    a('381005', 'De Propiedad, Planta y Equipo', 'equity', 'credit', '3810'),

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  CLASE 4 — INGRESOS                                         ║
    // ╚══════════════════════════════════════════════════════════════╝
    a('4', 'Ingresos', 'revenue', 'credit', null),

    // ── Grupo 41: Operacionales ──
    a('41', 'Operacionales', 'revenue', 'credit', '4'),
    a('4105', 'Agricultura, Ganadería, Caza y Silvicultura', 'revenue', 'credit', '41'),
    a('410505', 'Agricultura y Ganadería', 'revenue', 'credit', '4105'),
    a('4110', 'Pesca', 'revenue', 'credit', '41'),
    a('411005', 'Pesca y Acuicultura', 'revenue', 'credit', '4110'),
    a('4115', 'Explotación de Minas y Canteras', 'revenue', 'credit', '41'),
    a('411505', 'Minas y Canteras', 'revenue', 'credit', '4115'),
    a('4120', 'Industrias Manufactureras', 'revenue', 'credit', '41'),
    a('412005', 'Elaboración de Alimentos', 'revenue', 'credit', '4120'),
    a('412010', 'Elaboración de Bebidas', 'revenue', 'credit', '4120'),
    a('412015', 'Fabricación de Prendas de Vestir', 'revenue', 'credit', '4120'),
    a('412020', 'Fabricación de Productos Químicos', 'revenue', 'credit', '4120'),
    a('4125', 'Suministro de Electricidad, Gas y Agua', 'revenue', 'credit', '41'),
    a('412505', 'Suministro de Electricidad', 'revenue', 'credit', '4125'),
    a('4130', 'Construcción', 'revenue', 'credit', '41'),
    a('413005', 'Construcción de Edificios', 'revenue', 'credit', '4130'),
    a('4135', 'Comercio al por Mayor y al por Menor', 'revenue', 'credit', '41'),
    a('413505', 'Venta de Mercancías', 'revenue', 'credit', '4135'),
    a('413510', 'Venta de Mercancías al por Mayor', 'revenue', 'credit', '4135'),
    a('413515', 'Venta de Mercancías al por Menor', 'revenue', 'credit', '4135'),
    a('4140', 'Hoteles y Restaurantes', 'revenue', 'credit', '41'),
    a('414005', 'Hotelería', 'revenue', 'credit', '4140'),
    a('414010', 'Restaurantes', 'revenue', 'credit', '4140'),
    a('4145', 'Transporte, Almacenamiento y Comunicaciones', 'revenue', 'credit', '41'),
    a('414505', 'Transporte Terrestre', 'revenue', 'credit', '4145'),
    a('4150', 'Actividad Financiera', 'revenue', 'credit', '41'),
    a('415005', 'Actividad Financiera', 'revenue', 'credit', '4150'),
    a('4155', 'Actividades Inmobiliarias', 'revenue', 'credit', '41'),
    a('415505', 'Arrendamientos', 'revenue', 'credit', '4155'),
    a('4160', 'Enseñanza', 'revenue', 'credit', '41'),
    a('416005', 'Servicios de Enseñanza', 'revenue', 'credit', '4160'),
    a('4165', 'Servicios Sociales y de Salud', 'revenue', 'credit', '41'),
    a('416505', 'Servicios de Salud', 'revenue', 'credit', '4165'),
    a('4170', 'Otras Actividades de Servicios', 'revenue', 'credit', '41'),
    a('417005', 'Otras Actividades de Servicios', 'revenue', 'credit', '4170'),
    a('4175', 'Devoluciones en Ventas (DB)', 'revenue', 'debit', '41'),
    a('417505', 'Devoluciones en Ventas', 'revenue', 'debit', '4175'),
    a('417510', 'Rebajas y Descuentos en Ventas', 'revenue', 'debit', '4175'),

    // ── Grupo 42: No Operacionales ──
    a('42', 'No Operacionales', 'revenue', 'credit', '4'),
    a('4205', 'Otras Ventas', 'revenue', 'credit', '42'),
    a('420505', 'Venta de Material Reciclable', 'revenue', 'credit', '4205'),
    a('420510', 'Venta de Activos Fijos', 'revenue', 'credit', '4205'),
    a('4210', 'Financieros', 'revenue', 'credit', '42'),
    a('421005', 'Intereses', 'revenue', 'credit', '4210'),
    a('421010', 'Rendimientos Financieros', 'revenue', 'credit', '4210'),
    a('421020', 'Diferencia en Cambio', 'revenue', 'credit', '4210'),
    a('421040', 'Descuentos Comerciales Condicionados', 'revenue', 'credit', '4210'),
    a('4215', 'Dividendos y Participaciones', 'revenue', 'credit', '42'),
    a('421505', 'De Sociedades Anónimas', 'revenue', 'credit', '4215'),
    a('4220', 'Arrendamientos', 'revenue', 'credit', '42'),
    a('422005', 'Arrendamientos', 'revenue', 'credit', '4220'),
    a('4230', 'Servicios', 'revenue', 'credit', '42'),
    a('423005', 'Asistencia Técnica', 'revenue', 'credit', '4230'),
    a('4245', 'Utilidad en Venta de Inversiones', 'revenue', 'credit', '42'),
    a('424505', 'Utilidad en Venta de Inversiones', 'revenue', 'credit', '4245'),
    a('4250', 'Utilidad en Venta de PPE', 'revenue', 'credit', '42'),
    a('425005', 'Utilidad en Venta de Propiedad, Planta y Equipo', 'revenue', 'credit', '4250'),
    a('4255', 'Recuperaciones', 'revenue', 'credit', '42'),
    a('425505', 'Deudas Malas', 'revenue', 'credit', '4255'),
    a('425510', 'Provisiones', 'revenue', 'credit', '4255'),
    a('4260', 'Indemnizaciones', 'revenue', 'credit', '42'),
    a('426005', 'De Seguros', 'revenue', 'credit', '4260'),
    a('4275', 'Ingresos de Ejercicios Anteriores', 'revenue', 'credit', '42'),
    a('427505', 'Ingresos de Ejercicios Anteriores', 'revenue', 'credit', '4275'),
    a('4295', 'Diversos', 'revenue', 'credit', '42'),
    a('429505', 'Aprovechamientos', 'revenue', 'credit', '4295'),
    a('429510', 'Otros Ingresos No Operacionales', 'revenue', 'credit', '4295'),

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  CLASE 5 — GASTOS                                           ║
    // ╚══════════════════════════════════════════════════════════════╝
    a('5', 'Gastos', 'expense', 'debit', null),

    // ── Grupo 51: Operacionales de Administración ──
    a('51', 'Operacionales de Administración', 'expense', 'debit', '5'),
    a('5105', 'Gastos de Personal', 'expense', 'debit', '51'),
    a('510506', 'Sueldos', 'expense', 'debit', '5105'),
    a('510512', 'Jornales', 'expense', 'debit', '5105'),
    a('510515', 'Horas Extras y Recargos', 'expense', 'debit', '5105'),
    a('510518', 'Comisiones', 'expense', 'debit', '5105'),
    a('510521', 'Viáticos', 'expense', 'debit', '5105'),
    a('510524', 'Incapacidades', 'expense', 'debit', '5105'),
    a('510527', 'Auxilio de Transporte', 'expense', 'debit', '5105'),
    a('510530', 'Cesantías', 'expense', 'debit', '5105'),
    a('510533', 'Intereses sobre Cesantías', 'expense', 'debit', '5105'),
    a('510536', 'Prima de Servicios', 'expense', 'debit', '5105'),
    a('510539', 'Vacaciones', 'expense', 'debit', '5105'),
    a('510542', 'Primas Extralegales', 'expense', 'debit', '5105'),
    a('510545', 'Auxilios', 'expense', 'debit', '5105'),
    a('510548', 'Bonificaciones', 'expense', 'debit', '5105'),
    a('510551', 'Dotación y Suministro a Trabajadores', 'expense', 'debit', '5105'),
    a('510568', 'Aportes a EPS', 'expense', 'debit', '5105'),
    a('510569', 'Aportes a Pensión', 'expense', 'debit', '5105'),
    a('510570', 'Aportes a ARL', 'expense', 'debit', '5105'),
    a('510572', 'Aportes a Caja de Compensación', 'expense', 'debit', '5105'),
    a('510575', 'Aportes ICBF', 'expense', 'debit', '5105'),
    a('510578', 'Aportes SENA', 'expense', 'debit', '5105'),
    a('5110', 'Honorarios', 'expense', 'debit', '51'),
    a('511005', 'Junta Directiva', 'expense', 'debit', '5110'),
    a('511010', 'Revisoría Fiscal', 'expense', 'debit', '5110'),
    a('511015', 'Asesoría Jurídica', 'expense', 'debit', '5110'),
    a('511020', 'Asesoría Financiera', 'expense', 'debit', '5110'),
    a('511025', 'Asesoría Técnica', 'expense', 'debit', '5110'),
    a('511095', 'Otros Honorarios', 'expense', 'debit', '5110'),
    a('5115', 'Impuestos', 'expense', 'debit', '51'),
    a('511505', 'Industria y Comercio', 'expense', 'debit', '5115'),
    a('511510', 'De Timbres', 'expense', 'debit', '5115'),
    a('511515', 'A la Propiedad Raíz', 'expense', 'debit', '5115'),
    a('511520', 'Derechos sobre Instrumentos Públicos', 'expense', 'debit', '5115'),
    a('511570', 'ICA', 'expense', 'debit', '5115'),
    a('511595', 'Otros Impuestos', 'expense', 'debit', '5115'),
    a('5120', 'Arrendamientos', 'expense', 'debit', '51'),
    a('512005', 'Locales', 'expense', 'debit', '5120'),
    a('512010', 'Maquinaria y Equipo', 'expense', 'debit', '5120'),
    a('512015', 'Equipo de Computación', 'expense', 'debit', '5120'),
    a('512020', 'Equipo de Oficina', 'expense', 'debit', '5120'),
    a('5125', 'Contribuciones y Afiliaciones', 'expense', 'debit', '51'),
    a('512505', 'Cámara de Comercio', 'expense', 'debit', '5125'),
    a('512510', 'Gremios y Asociaciones', 'expense', 'debit', '5125'),
    a('5130', 'Seguros', 'expense', 'debit', '51'),
    a('513005', 'Incendio', 'expense', 'debit', '5130'),
    a('513010', 'Terremoto', 'expense', 'debit', '5130'),
    a('513015', 'Sustracción y Hurto', 'expense', 'debit', '5130'),
    a('513025', 'Cumplimiento', 'expense', 'debit', '5130'),
    a('513030', 'Vida Colectiva', 'expense', 'debit', '5130'),
    a('513035', 'Responsabilidad Civil', 'expense', 'debit', '5130'),
    a('513040', 'Vehículos', 'expense', 'debit', '5130'),
    a('5135', 'Servicios', 'expense', 'debit', '51'),
    a('513505', 'Aseo y Vigilancia', 'expense', 'debit', '5135'),
    a('513510', 'Temporales', 'expense', 'debit', '5135'),
    a('513515', 'Asistencia Técnica', 'expense', 'debit', '5135'),
    a('513520', 'Procesamiento Electrónico de Datos', 'expense', 'debit', '5135'),
    a('513525', 'Acueducto y Alcantarillado', 'expense', 'debit', '5135'),
    a('513530', 'Energía Eléctrica', 'expense', 'debit', '5135'),
    a('513535', 'Teléfono e Internet', 'expense', 'debit', '5135'),
    a('513540', 'Correo, Portes y Telegramas', 'expense', 'debit', '5135'),
    a('513545', 'Gas', 'expense', 'debit', '5135'),
    a('513550', 'Transporte, Fletes y Acarreos', 'expense', 'debit', '5135'),
    a('513595', 'Otros Servicios', 'expense', 'debit', '5135'),
    a('5140', 'Gastos Legales', 'expense', 'debit', '51'),
    a('514005', 'Notariales', 'expense', 'debit', '5140'),
    a('514010', 'Registro Mercantil', 'expense', 'debit', '5140'),
    a('514015', 'Trámites y Licencias', 'expense', 'debit', '5140'),
    a('5145', 'Mantenimiento y Reparaciones', 'expense', 'debit', '51'),
    a('514505', 'Construcciones y Edificaciones', 'expense', 'debit', '5145'),
    a('514510', 'Maquinaria y Equipo', 'expense', 'debit', '5145'),
    a('514515', 'Equipo de Oficina', 'expense', 'debit', '5145'),
    a('514520', 'Equipo de Computación', 'expense', 'debit', '5145'),
    a('514525', 'Flota y Equipo de Transporte', 'expense', 'debit', '5145'),
    a('5150', 'Adecuación e Instalación', 'expense', 'debit', '51'),
    a('515005', 'Instalaciones Eléctricas', 'expense', 'debit', '5150'),
    a('515010', 'Reparaciones Locativas', 'expense', 'debit', '5150'),
    a('5155', 'Gastos de Viaje', 'expense', 'debit', '51'),
    a('515505', 'Alojamiento y Manutención', 'expense', 'debit', '5155'),
    a('515510', 'Pasajes Aéreos', 'expense', 'debit', '5155'),
    a('515515', 'Pasajes Terrestres', 'expense', 'debit', '5155'),
    a('5160', 'Depreciaciones', 'expense', 'debit', '51'),
    a('516005', 'Construcciones y Edificaciones', 'expense', 'debit', '5160'),
    a('516010', 'Maquinaria y Equipo', 'expense', 'debit', '5160'),
    a('516015', 'Equipo de Oficina', 'expense', 'debit', '5160'),
    a('516020', 'Equipo de Computación', 'expense', 'debit', '5160'),
    a('516035', 'Flota y Equipo de Transporte', 'expense', 'debit', '5160'),
    a('5165', 'Amortizaciones', 'expense', 'debit', '51'),
    a('516505', 'Intangibles', 'expense', 'debit', '5165'),
    a('516510', 'Cargos Diferidos', 'expense', 'debit', '5165'),
    a('5195', 'Diversos', 'expense', 'debit', '51'),
    a('519505', 'Elementos de Aseo y Cafetería', 'expense', 'debit', '5195'),
    a('519510', 'Útiles, Papelería y Fotocopias', 'expense', 'debit', '5195'),
    a('519515', 'Combustibles y Lubricantes', 'expense', 'debit', '5195'),
    a('519520', 'Envases y Empaques', 'expense', 'debit', '5195'),
    a('519525', 'Taxis y Buses', 'expense', 'debit', '5195'),
    a('519530', 'Gastos de Representación', 'expense', 'debit', '5195'),
    a('519535', 'Casino y Restaurante', 'expense', 'debit', '5195'),
    a('519540', 'Publicidad y Propaganda', 'expense', 'debit', '5195'),
    a('519545', 'Parqueaderos', 'expense', 'debit', '5195'),
    a('519595', 'Otros Gastos Diversos', 'expense', 'debit', '5195'),
    a('5199', 'Provisiones', 'expense', 'debit', '51'),
    a('519905', 'Inversiones', 'expense', 'debit', '5199'),
    a('519910', 'Deudores', 'expense', 'debit', '5199'),
    a('519915', 'Propiedades, Planta y Equipo', 'expense', 'debit', '5199'),

    // ── Grupo 52: Operacionales de Ventas ──
    a('52', 'Operacionales de Ventas', 'expense', 'debit', '5'),
    a('5205', 'Gastos de Personal', 'expense', 'debit', '52'),
    a('520506', 'Sueldos', 'expense', 'debit', '5205'),
    a('520515', 'Horas Extras', 'expense', 'debit', '5205'),
    a('520518', 'Comisiones de Ventas', 'expense', 'debit', '5205'),
    a('520527', 'Auxilio de Transporte', 'expense', 'debit', '5205'),
    a('520530', 'Cesantías', 'expense', 'debit', '5205'),
    a('520533', 'Intereses sobre Cesantías', 'expense', 'debit', '5205'),
    a('520536', 'Prima de Servicios', 'expense', 'debit', '5205'),
    a('520539', 'Vacaciones', 'expense', 'debit', '5205'),
    a('520568', 'Aportes a EPS', 'expense', 'debit', '5205'),
    a('520569', 'Aportes a Pensión', 'expense', 'debit', '5205'),
    a('520570', 'Aportes a ARL', 'expense', 'debit', '5205'),
    a('520572', 'Aportes a Caja de Compensación', 'expense', 'debit', '5205'),
    a('5210', 'Honorarios', 'expense', 'debit', '52'),
    a('521005', 'Asesoría Comercial', 'expense', 'debit', '5210'),
    a('5215', 'Impuestos', 'expense', 'debit', '52'),
    a('521505', 'Industria y Comercio', 'expense', 'debit', '5215'),
    a('5220', 'Arrendamientos', 'expense', 'debit', '52'),
    a('522005', 'Locales', 'expense', 'debit', '5220'),
    a('5225', 'Contribuciones y Afiliaciones', 'expense', 'debit', '52'),
    a('522505', 'Contribuciones y Afiliaciones', 'expense', 'debit', '5225'),
    a('5230', 'Seguros', 'expense', 'debit', '52'),
    a('523005', 'Seguros de Ventas', 'expense', 'debit', '5230'),
    a('5235', 'Servicios', 'expense', 'debit', '52'),
    a('523505', 'Aseo y Vigilancia', 'expense', 'debit', '5235'),
    a('523530', 'Energía Eléctrica', 'expense', 'debit', '5235'),
    a('523535', 'Teléfono e Internet', 'expense', 'debit', '5235'),
    a('523550', 'Transporte, Fletes y Acarreos', 'expense', 'debit', '5235'),
    a('523595', 'Otros Servicios', 'expense', 'debit', '5235'),
    a('5240', 'Gastos Legales', 'expense', 'debit', '52'),
    a('524005', 'Gastos Legales de Ventas', 'expense', 'debit', '5240'),
    a('5245', 'Mantenimiento y Reparaciones', 'expense', 'debit', '52'),
    a('524505', 'Mantenimiento de Ventas', 'expense', 'debit', '5245'),
    a('5255', 'Gastos de Viaje', 'expense', 'debit', '52'),
    a('525505', 'Alojamiento y Manutención', 'expense', 'debit', '5255'),
    a('5260', 'Depreciaciones', 'expense', 'debit', '52'),
    a('526005', 'Depreciaciones de Ventas', 'expense', 'debit', '5260'),
    a('5295', 'Diversos', 'expense', 'debit', '52'),
    a('529505', 'Faltantes de Inventario', 'expense', 'debit', '5295'),
    a('529510', 'Empaques y Envases', 'expense', 'debit', '5295'),
    a('529515', 'Publicidad y Propaganda', 'expense', 'debit', '5295'),
    a('529520', 'Muestras y Degustaciones', 'expense', 'debit', '5295'),
    a('529595', 'Otros Gastos de Ventas', 'expense', 'debit', '5295'),

    // ── Grupo 53: No Operacionales ──
    a('53', 'No Operacionales', 'expense', 'debit', '5'),
    a('5305', 'Gastos Financieros', 'expense', 'debit', '53'),
    a('530505', 'Gastos Bancarios', 'expense', 'debit', '5305'),
    a('530510', 'Reajuste Monetario - UPAC/UVR', 'expense', 'debit', '5305'),
    a('530515', 'Comisiones', 'expense', 'debit', '5305'),
    a('530520', 'Intereses', 'expense', 'debit', '5305'),
    a('530525', 'Diferencia en Cambio', 'expense', 'debit', '5305'),
    a('530530', 'Gravamen Movimientos Financieros (4x1000)', 'expense', 'debit', '5305'),
    a('530595', 'Otros Gastos Financieros', 'expense', 'debit', '5305'),
    a('5310', 'Pérdida en Venta y Retiro de Bienes', 'expense', 'debit', '53'),
    a('531005', 'Venta de Inversiones', 'expense', 'debit', '5310'),
    a('531010', 'Venta de Propiedad, Planta y Equipo', 'expense', 'debit', '5310'),
    a('5313', 'Pérdidas Método de Participación', 'expense', 'debit', '53'),
    a('531305', 'Pérdidas Método de Participación', 'expense', 'debit', '5313'),
    a('5315', 'Gastos Extraordinarios', 'expense', 'debit', '53'),
    a('531505', 'Costos de Activos Dados de Baja', 'expense', 'debit', '5315'),
    a('531510', 'Multas y Sanciones', 'expense', 'debit', '5315'),
    a('531515', 'Demandas Laborales', 'expense', 'debit', '5315'),
    a('531520', 'Indemnizaciones', 'expense', 'debit', '5315'),
    a('5395', 'Gastos Diversos', 'expense', 'debit', '53'),
    a('539505', 'Donaciones', 'expense', 'debit', '5395'),
    a('539510', 'Gastos de Ejercicios Anteriores', 'expense', 'debit', '5395'),
    a('539595', 'Otros Gastos No Operacionales', 'expense', 'debit', '5395'),

    // ── Grupo 54: Impuesto de Renta y Complementarios ──
    a('54', 'Impuesto de Renta y Complementarios', 'expense', 'debit', '5'),
    a('5405', 'Impuesto de Renta y Complementarios', 'expense', 'debit', '54'),
    a('540505', 'Impuesto de Renta Corriente', 'expense', 'debit', '5405'),
    a('540510', 'Impuesto de Renta Diferido', 'expense', 'debit', '5405'),

    // ── Grupo 59: Ganancias y Pérdidas ──
    a('59', 'Ganancias y Pérdidas', 'expense', 'debit', '5'),
    a('5905', 'Ganancias y Pérdidas', 'expense', 'debit', '59'),
    a('590505', 'Ganancias y Pérdidas', 'expense', 'debit', '5905'),

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  CLASE 6 — COSTOS DE VENTA                                   ║
    // ╚══════════════════════════════════════════════════════════════╝
    a('6', 'Costos de Venta', 'expense', 'debit', null),

    // ── Grupo 61: Costo de Ventas y Prestación de Servicios ──
    a('61', 'Costo de Ventas y Prestación de Servicios', 'expense', 'debit', '6'),
    a('6105', 'Agricultura, Ganadería, Caza y Silvicultura', 'expense', 'debit', '61'),
    a('610505', 'Agricultura y Ganadería', 'expense', 'debit', '6105'),
    a('6110', 'Pesca', 'expense', 'debit', '61'),
    a('611005', 'Pesca y Acuicultura', 'expense', 'debit', '6110'),
    a('6115', 'Explotación de Minas y Canteras', 'expense', 'debit', '61'),
    a('611505', 'Minas y Canteras', 'expense', 'debit', '6115'),
    a('6120', 'Industrias Manufactureras', 'expense', 'debit', '61'),
    a('612005', 'Elaboración de Alimentos', 'expense', 'debit', '6120'),
    a('612010', 'Elaboración de Bebidas', 'expense', 'debit', '6120'),
    a('612015', 'Fabricación de Prendas de Vestir', 'expense', 'debit', '6120'),
    a('6125', 'Suministro de Electricidad, Gas y Agua', 'expense', 'debit', '61'),
    a('612505', 'Suministro de Electricidad', 'expense', 'debit', '6125'),
    a('6130', 'Construcción', 'expense', 'debit', '61'),
    a('613005', 'Construcción de Edificios', 'expense', 'debit', '6130'),
    a('6135', 'Comercio al por Mayor y al por Menor', 'expense', 'debit', '61'),
    a('613505', 'Costo de Mercancías Vendidas', 'expense', 'debit', '6135'),
    a('6140', 'Hoteles y Restaurantes', 'expense', 'debit', '61'),
    a('614005', 'Costos de Hotelería', 'expense', 'debit', '6140'),
    a('614010', 'Costos de Restaurante', 'expense', 'debit', '6140'),
    a('6145', 'Transporte, Almacenamiento y Comunicaciones', 'expense', 'debit', '61'),
    a('614505', 'Costos de Transporte', 'expense', 'debit', '6145'),
    a('6150', 'Actividad Financiera', 'expense', 'debit', '61'),
    a('615005', 'Costos Financieros', 'expense', 'debit', '6150'),
    a('6155', 'Actividades Inmobiliarias', 'expense', 'debit', '61'),
    a('615505', 'Costos Inmobiliarios', 'expense', 'debit', '6155'),
    a('6160', 'Enseñanza', 'expense', 'debit', '61'),
    a('616005', 'Costos de Enseñanza', 'expense', 'debit', '6160'),
    a('6165', 'Servicios Sociales y de Salud', 'expense', 'debit', '61'),
    a('616505', 'Costos de Servicios de Salud', 'expense', 'debit', '6165'),
    a('6170', 'Otras Actividades de Servicios', 'expense', 'debit', '61'),
    a('617005', 'Costos de Servicios Comunitarios', 'expense', 'debit', '6170'),

    // ── Grupo 62: Compras ──
    a('62', 'Compras', 'expense', 'debit', '6'),
    a('6205', 'De Mercancías', 'expense', 'debit', '62'),
    a('620505', 'Compras de Mercancías Nacionales', 'expense', 'debit', '6205'),
    a('620510', 'Compras de Mercancías del Exterior', 'expense', 'debit', '6205'),
    a('6210', 'De Materias Primas', 'expense', 'debit', '62'),
    a('621005', 'Compras de Materias Primas', 'expense', 'debit', '6210'),
    a('6215', 'Devoluciones en Compras (CR)', 'expense', 'credit', '62'),
    a('621505', 'Devoluciones en Compras', 'expense', 'credit', '6215'),
    a('621510', 'Rebajas y Descuentos en Compras', 'expense', 'credit', '6215'),

    // ── Grupo 7: Costos de Producción o de Operación ──
    a('7', 'Costos de Producción', 'expense', 'debit', null),

    // ── Grupo 71: Materia Prima ──
    a('71', 'Materia Prima', 'expense', 'debit', '7'),
    a('7105', 'Materias Primas', 'expense', 'debit', '71'),
    a('710505', 'Materias Primas Consumidas', 'expense', 'debit', '7105'),

    // ── Grupo 72: Mano de Obra Directa ──
    a('72', 'Mano de Obra Directa', 'expense', 'debit', '7'),
    a('7205', 'Mano de Obra Directa', 'expense', 'debit', '72'),
    a('720505', 'Sueldos y Jornales', 'expense', 'debit', '7205'),
    a('720515', 'Horas Extras', 'expense', 'debit', '7205'),
    a('720530', 'Cesantías', 'expense', 'debit', '7205'),
    a('720533', 'Intereses sobre Cesantías', 'expense', 'debit', '7205'),
    a('720536', 'Prima de Servicios', 'expense', 'debit', '7205'),
    a('720539', 'Vacaciones', 'expense', 'debit', '7205'),
    a('720568', 'Aportes a EPS', 'expense', 'debit', '7205'),
    a('720569', 'Aportes a Pensión', 'expense', 'debit', '7205'),
    a('720570', 'Aportes a ARL', 'expense', 'debit', '7205'),

    // ── Grupo 73: Costos Indirectos de Fabricación ──
    a('73', 'Costos Indirectos', 'expense', 'debit', '7'),
    a('7305', 'Materiales Indirectos', 'expense', 'debit', '73'),
    a('730505', 'Materiales Indirectos', 'expense', 'debit', '7305'),
    a('7310', 'Mano de Obra Indirecta', 'expense', 'debit', '73'),
    a('731005', 'Sueldos', 'expense', 'debit', '7310'),
    a('7315', 'Otros Costos Indirectos', 'expense', 'debit', '73'),
    a('731505', 'Arrendamientos', 'expense', 'debit', '7315'),
    a('731510', 'Servicios Públicos', 'expense', 'debit', '7315'),
    a('731515', 'Seguros', 'expense', 'debit', '7315'),
    a('731520', 'Depreciación', 'expense', 'debit', '7315'),
    a('731525', 'Mantenimiento y Reparaciones', 'expense', 'debit', '7315'),
  ];
}
