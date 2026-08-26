import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

import {
  buildDefaultAiuProfileConfig,
} from './invoice-profile-config.contract';
import { ProfileAccountHealthService } from './profile-account-health.service';
import { ProfileAccountingValidator } from './profile-accounting.validator';

/**
 * PANEL DE SALUD F.13 — la última casilla viva: MARCAR las versiones vigentes
 * legadas sin reescribirlas.
 *
 * El panel no tiene criterio propio: juzga con el MISMO
 * `ProfileAccountingValidator` que rechaza el guardado (aquí instanciado REAL,
 * con FiscalScopeService real y sólo la red doblada), así que estos casos
 * fijan el contrato del endpoint — qué filas aparecen, con qué issues y bajo
 * qué versión — y la garantía de coste: tres consultas sin importar cuántos
 * perfiles haya.
 */
describe('ProfileAccountHealthService — panel de salud PUC por fiscal scope', () => {
  const ORG_ID = 6;
  const STORE_ID = 10;

  type AccountRow = { code: string; accepts_entries: boolean };

  interface ProfileRow {
    id: number;
    name: string;
    state: string;
    current_version: number;
    store_id: number;
    organization_id: number;
  }

  interface VersionRow {
    profile_id: number;
    version: number;
    config: Record<string, any>;
  }

  interface Harness {
    service: ProfileAccountHealthService;
    chart_reads: any[];
    entity_reads: any[];
    setProfiles(rows: ProfileRow[]): void;
    setVersions(rows: VersionRow[]): void;
    setAccounts(rows: AccountRow[]): void;
    setEntity(entityId: number | null): void;
  }

  function makeHarness(fiscal_scope: 'STORE' | 'ORGANIZATION' = 'STORE'): Harness {
    let profiles: ProfileRow[] = [];
    let versions: VersionRow[] = [];
    let account_rows: AccountRow[] = [];
    let entity: { id: number } | null = { id: 25 };

    const chart_reads: any[] = [];
    const entity_reads: any[] = [];

    const remote = {
      organizations: {
        findUnique: jest.fn(() =>
          Promise.resolve({ fiscal_scope }),
        ),
      },
      accounting_entities: {
        findFirst: jest.fn((args: any) => {
          entity_reads.push(args?.where);
          return Promise.resolve(entity);
        }),
      },
    };

    const scoped = {
      invoice_profiles: {
        findMany: jest.fn(() => Promise.resolve(profiles)),
      },
      invoice_profile_versions: {
        findMany: jest.fn((args: any) => {
          // Réplica mínima del OR (profile_id, version) que hará Prisma.
          const pairs: any[] = args?.where?.OR ?? [];
          return Promise.resolve(
            versions.filter((row) =>
              pairs.some(
                (pair) =>
                  pair.profile_id === row.profile_id &&
                  pair.version === row.version,
              ),
            ),
          );
        }),
      },
      chart_of_accounts: {
        findMany: jest.fn((args: any) => {
          chart_reads.push(args?.where);
          return Promise.resolve(account_rows);
        }),
      },
    };

    const prisma = {
      ...scoped,
      withoutScope: jest.fn().mockReturnValue(remote),
    } as any;

    const fiscal_scope_service = new FiscalScopeService(prisma);
    const validator = new ProfileAccountingValidator(prisma, fiscal_scope_service);
    const service = new ProfileAccountHealthService(prisma, validator);

    return {
      service,
      chart_reads,
      entity_reads,
      setProfiles: (rows) => (profiles = rows),
      setVersions: (rows) => (versions = rows),
      setAccounts: (rows) => (account_rows = rows),
      setEntity: (id) => (entity = id === null ? null : { id }),
    };
  }

  function configWithAccounting(accounting: Record<string, any>): Record<string, any> {
    const config: any = JSON.parse(
      JSON.stringify(buildDefaultAiuProfileConfig('Panel F.13')),
    );
    config.accounting = { ...config.accounting, ...accounting };
    return config as any;
  }

  function profileRow(overrides: Partial<ProfileRow>): ProfileRow {
    return {
      id: 1,
      name: 'Perfil',
      state: 'active',
      current_version: 1,
      store_id: STORE_ID,
      organization_id: ORG_ID,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: ORG_ID, store_id: STORE_ID } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('un perfil SANO queda fuera del panel: se le juzga y no produce issues', async () => {
    const h = makeHarness();
    h.setProfiles([profileRow({})]);
    h.setVersions([
      {
        profile_id: 1,
        version: 1,
        config: configWithAccounting({
          revenue_account_by_bucket: { costo: '413505' },
        }),
      },
    ]);
    h.setAccounts([{ code: '413505', accepts_entries: true }]);

    const rows = await h.service.health();

    expect(rows).toEqual([]);
    expect(h.chart_reads).toHaveLength(1);
    expect(h.entity_reads).toHaveLength(1);
  });

  it('una sección contable VACÍA (heredar mapeo) no dispara resolutor ni lectura de PUC', async () => {
    const h = makeHarness();
    h.setProfiles([profileRow({})]);
    h.setVersions([
      {
        profile_id: 1,
        version: 1,
        config: configWithAccounting({
          revenue_account_by_bucket: null,
          vat_payable_account: null,
          mapping_key_overrides: null,
        }),
      },
    ]);

    const rows = await h.service.health();

    expect(rows).toEqual([]);
    expect(h.entity_reads).toHaveLength(0);
    expect(h.chart_reads).toHaveLength(0);
  });

  it('el perfil legado con 413501 aparece nombrando el bucket exacto', async () => {
    const h = makeHarness();
    h.setProfiles([profileRow({ id: 8, name: 'AIU legado', current_version: 3 })]);
    h.setVersions([
      {
        profile_id: 8,
        version: 3,
        config: configWithAccounting({
          revenue_account_by_bucket: { costo: '413501' },
        }),
      },
    ]);
    h.setAccounts([]); // 413501 no está en ningún PUC

    const rows = await h.service.health();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      profile_id: 8,
      name: 'AIU legado',
      state: 'active',
      version: 3,
      issues: [
        {
          field: 'accounting.revenue_account_by_bucket.costo',
          code: 'ACCOUNT_NOT_IN_CHART',
        },
      ],
    });
  });

  it('una cuenta de AGRUPACIÓN se marca ACCOUNT_DOES_NOT_ACCEPT_ENTRIES, no como inexistente', async () => {
    const h = makeHarness();
    h.setProfiles([profileRow({})]);
    h.setVersions([
      {
        profile_id: 1,
        version: 1,
        config: configWithAccounting({
          revenue_account_by_bucket: { costo: '4135' },
        }),
      },
    ]);
    h.setAccounts([{ code: '4135', accepts_entries: false }]);

    const rows = await h.service.health();

    expect(rows[0].issues).toEqual([
      {
        field: 'accounting.revenue_account_by_bucket.costo',
        code: 'ACCOUNT_DOES_NOT_ACCEPT_ENTRIES',
      },
    ]);
  });

  it('marca también vat_payable_account y mapping_key_overrides, todos juntos', async () => {
    const h = makeHarness();
    h.setProfiles([profileRow({ state: 'inactive', current_version: 2 })]);
    h.setVersions([
      {
        profile_id: 1,
        version: 2,
        config: configWithAccounting({
          vat_payable_account: '240802',
          mapping_key_overrides: { sales_income: '495834' },
        }),
      },
    ]);
    h.setAccounts([]);

    const rows = await h.service.health();

    expect(rows[0].version).toBe(2);
    expect(rows[0].state).toBe('inactive');
    expect(rows[0].issues.map((issue) => issue.field)).toEqual([
      'accounting.vat_payable_account',
      'accounting.mapping_key_overrides.sales_income',
    ]);
    expect(rows[0].issues.every((issue) => issue.code === 'ACCOUNT_NOT_IN_CHART')).toBe(
      true,
    );
  });

  it('sólo juzga la versión ACTUAL: una versión vieja inválida bajo un perfil corregido no aparece', async () => {
    const h = makeHarness();
    h.setProfiles([profileRow({ current_version: 2 })]);
    h.setVersions([
      {
        // v1 legada con el código malo — append-only, intacta, pero ya no rige.
        profile_id: 1,
        version: 1,
        config: configWithAccounting({
          revenue_account_by_bucket: { costo: '413501' },
        }),
      },
      {
        profile_id: 1,
        version: 2,
        config: configWithAccounting({
          revenue_account_by_bucket: { costo: '413505' },
        }),
      },
    ]);
    h.setAccounts([{ code: '413505', accepts_entries: true }]);

    const rows = await h.service.health();

    expect(rows).toEqual([]);
    // La unión de códigos pedidos al PUC es SOLO la de las versiones vigentes.
    expect(h.chart_reads[0].code.in).toEqual(['413505']);
  });

  it('N perfiles cuestan UNA resolución de alcance y UNA lectura del PUC (unión de códigos)', async () => {
    const h = makeHarness();
    h.setProfiles([
      profileRow({ id: 8 }),
      profileRow({ id: 77 }),
      profileRow({ id: 90, current_version: 4 }),
    ]);
    h.setVersions([
      {
        profile_id: 8,
        version: 1,
        config: configWithAccounting({
          revenue_account_by_bucket: { costo: '413501' },
        }),
      },
      {
        profile_id: 77,
        version: 1,
        config: configWithAccounting({
          revenue_account_by_bucket: { imprevistos: '543543' },
        }),
      },
      {
        profile_id: 90,
        version: 4,
        config: configWithAccounting({
          revenue_account_by_bucket: { utilidad: '534534' },
        }),
      },
    ]);
    h.setAccounts([]);

    const rows = await h.service.health();

    expect(h.entity_reads).toHaveLength(1);
    expect(h.chart_reads).toHaveLength(1);
    expect([...h.chart_reads[0].code.in].sort()).toEqual([
      '413501',
      '534534',
      '543543',
    ]);
    expect(rows).toHaveLength(3);
  });

  it('una tienda SIN perfiles responde vacía sin tocar el resolutor fiscal', async () => {
    const h = makeHarness();
    h.setProfiles([]);

    const rows = await h.service.health();

    expect(rows).toEqual([]);
    expect(h.entity_reads).toHaveLength(0);
    expect(h.chart_reads).toHaveLength(0);
  });

  it('perfiles sanos y enfermos conviven: sólo los enfermos entran a data', async () => {
    const h = makeHarness();
    h.setProfiles([
      profileRow({ id: 91, name: 'Sano' }),
      profileRow({ id: 92, name: 'Enfermo' }),
    ]);
    h.setVersions([
      {
        profile_id: 91,
        version: 1,
        config: configWithAccounting({
          revenue_account_by_bucket: { costo: '413505' },
        }),
      },
      {
        profile_id: 92,
        version: 1,
        config: configWithAccounting({
          revenue_account_by_bucket: { costo: '413501' },
        }),
      },
    ]);
    h.setAccounts([{ code: '413505', accepts_entries: true }]);

    const rows = await h.service.health();

    expect(rows.map((row) => row.profile_id)).toEqual([92]);
  });
});
