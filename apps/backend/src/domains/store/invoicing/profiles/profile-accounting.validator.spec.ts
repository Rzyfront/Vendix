import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

import {
  buildDefaultAiuProfileConfig,
} from './invoice-profile-config.contract';
import { ProfileAccountingValidator } from './profile-accounting.validator';

/**
 * COMPUERTA F.13 — el resolutor de alcance es la mitad del diseño.
 *
 * El validador no adivina contra qué PUC juzga: delega en el MISMO
 * `FiscalScopeService` que usa el módulo de contabilidad para servir las
 * cuentas que el editor ofrece. Estos casos fijan la resolución por
 * `organizations.fiscal_scope` con un FiscalScopeService REAL (sólo se dobla
 * la red), porque un stub aquí probaría el validador contra el alcance que el
 * test sueña, no contra el que la base le da.
 */
describe('ProfileAccountingValidator — compuerta PUC por fiscal scope', () => {
  const ORG_ID = 6;
  const STORE_ID = 10;

  /** Fila que `chart_of_accounts` devolvería para el PUC resuelto. */
  type AccountRow = { code: string; accepts_entries: boolean };

  interface Harness {
    validator: ProfileAccountingValidator;
    fiscal_scope_service: FiscalScopeService;
    chart_reads: any[];
    entity_reads: any[];
    scope_reads: any[];
    setAccounts(rows: AccountRow[]): void;
    setEntity(entityId: number | null): void;
  }

  /**
   * @param fiscal_scope lo que `organizations.fiscal_scope` dice de la org 6.
   *                     La cadena de fallback del resolutor (operating_scope /
   *                     account_type) no se ejercita acá: es dueño de otro skill.
   */
  function makeHarness(fiscal_scope: 'STORE' | 'ORGANIZATION'): Harness {
    let account_rows: AccountRow[] = [];
    let entity: { id: number } | null = { id: 25 };

    const chart_reads: any[] = [];
    const entity_reads: any[] = [];
    const scope_reads: any[] = [];

    const remote = {
      // `getFiscalScope` lee la organización por `withoutScope`.
      organizations: {
        findUnique: jest.fn((args: any) => {
          scope_reads.push(args?.where);
          return Promise.resolve(
            args?.where?.id === ORG_ID ? { fiscal_scope } : null,
          );
        }),
      },
      // `findFiscalAccountingEntityId` lee la entidad por `withoutScope`.
      accounting_entities: {
        findFirst: jest.fn((args: any) => {
          entity_reads.push(args?.where);
          return Promise.resolve(entity);
        }),
      },
    };

    const scoped = {
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

    return {
      validator,
      fiscal_scope_service,
      chart_reads,
      entity_reads,
      scope_reads,
      setAccounts: (rows) => (account_rows = rows),
      setEntity: (id) => (entity = id === null ? null : { id }),
    };
  }

  function configWithAccounting(accounting: Record<string, any>): Record<string, any> {
    const config: any = JSON.parse(
      JSON.stringify(buildDefaultAiuProfileConfig('Compuerta F.13')),
    );
    config.accounting = { ...config.accounting, ...accounting };
    return config as any;
  }

  const SCOPE = {
    organization_id: ORG_ID,
    store_id: STORE_ID,
    operation_type: '09',
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: ORG_ID, store_id: STORE_ID } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('scope STORE valida contra la entidad contable de la tienda y acepta una cuenta imputable (413505)', async () => {
    const h = makeHarness('STORE');
    h.setAccounts([{ code: '413505', accepts_entries: true }]);

    await h.validator.assertAccountsUsable(
      configWithAccounting({
        revenue_account_by_bucket: { costo: '413505' },
      }) as any,
      SCOPE,
    );

    expect(h.entity_reads[0]).toMatchObject({
      organization_id: ORG_ID,
      store_id: STORE_ID,
      scope: 'STORE',
      fiscal_scope: 'STORE',
    });
    expect(h.chart_reads[0]).toMatchObject({
      organization_id: ORG_ID,
      accounting_entity_id: 25,
      code: { in: ['413505'] },
    });
  });

  it('scope ORGANIZATION valida contra el PUC de nivel organización, no el de la tienda', async () => {
    const h = makeHarness('ORGANIZATION');
    // El resolutor busca la entidad con store_id NULL bajo scope ORGANIZATION:
    // es el PUC que gobierna los asientos cuando la entidad fiscal es una sola.
    h.setEntity(26);
    h.setAccounts([{ code: '413510', accepts_entries: true }]);

    await h.validator.assertAccountsUsable(
      configWithAccounting({
        revenue_account_by_bucket: { administracion: '413510' },
      }) as any,
      SCOPE,
    );

    expect(h.entity_reads[0]).toMatchObject({
      organization_id: ORG_ID,
      store_id: null,
      scope: 'ORGANIZATION',
      fiscal_scope: 'ORGANIZATION',
    });
    expect(h.chart_reads[0].accounting_entity_id).toBe(26);
  });

  it('un código inexistente (413501) rechaza 422 nombrando el campo exacto del bucket', async () => {
    const h = makeHarness('STORE');
    h.setAccounts([]); // el PUC no trae 413501 en ninguna organización

    const error = await h.validator
      .assertAccountsUsable(
        configWithAccounting({
          revenue_account_by_bucket: { costo: '413501' },
        }) as any,
        SCOPE,
      )
      .catch((e) => e);

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse().error_code).toBe('INVOICING_PROFILE_010');
    const issues = error.getResponse().details.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      field: 'accounting.revenue_account_by_bucket.costo',
      code: 'ACCOUNT_NOT_IN_CHART',
    });
    expect(issues[0].message).toContain('413501');
  });

  it('una cuenta de AGRUPACIÓN existe y aun así se rechaza: falta accepts_entries', async () => {
    const h = makeHarness('STORE');
    h.setAccounts([{ code: '4135', accepts_entries: false }]);

    const error = await h.validator
      .assertAccountsUsable(
        configWithAccounting({
          revenue_account_by_bucket: { costo: '4135' },
        }) as any,
        SCOPE,
      )
      .catch((e) => e);

    expect(error.getResponse().details.issues[0]).toMatchObject({
      field: 'accounting.revenue_account_by_bucket.costo',
      code: 'ACCOUNT_DOES_NOT_ACCEPT_ENTRIES',
    });
  });

  it('el IVA por pagar rechaza nombrando accounting.vat_payable_account', async () => {
    const h = makeHarness('STORE');
    h.setAccounts([]);

    const error = await h.validator
      .assertAccountsUsable(
        configWithAccounting({ vat_payable_account: '240802' }) as any,
        SCOPE,
      )
      .catch((e) => e);

    expect(error.getResponse().details.issues[0]).toMatchObject({
      field: 'accounting.vat_payable_account',
      code: 'ACCOUNT_NOT_IN_CHART',
    });
  });

  it('las sobrescrituras de mapping_key también corren la compuerta', async () => {
    const h = makeHarness('STORE');
    h.setAccounts([{ code: '413505', accepts_entries: true }]);

    const error = await h.validator
      .assertAccountsUsable(
        configWithAccounting({
          revenue_account_by_bucket: { costo: '413505' },
          mapping_key_overrides: { sales_income: '495834' },
        }) as any,
        SCOPE,
      )
      .catch((e) => e);

    expect(error.getResponse().details.issues).toHaveLength(1);
    expect(error.getResponse().details.issues[0]).toMatchObject({
      field: 'accounting.mapping_key_overrides.sales_income',
      code: 'ACCOUNT_NOT_IN_CHART',
    });
  });

  it('la sección contable vacía (heredar mapeo de tienda) ni consulta el PUC', async () => {
    const h = makeHarness('STORE');

    await h.validator.assertAccountsUsable(
      configWithAccounting({
        revenue_account_by_bucket: null,
        vat_payable_account: null,
        mapping_key_overrides: null,
      }) as any,
      SCOPE,
    );

    expect(h.chart_reads).toHaveLength(0);
    expect(h.entity_reads).toHaveLength(0);
  });

  it('un tenant SIN PUC todavía rechaza cualquier código pedido, honestamente', async () => {
    const h = makeHarness('STORE');
    h.setEntity(null); // no existe la entidad contable: no hay PUC que contenga nada

    const error = await h.validator
      .assertAccountsUsable(
        configWithAccounting({ vat_payable_account: '240802' }) as any,
        SCOPE,
      )
      .catch((e) => e);

    expect(error.getResponse().details.issues[0]).toMatchObject({
      field: 'accounting.vat_payable_account',
      code: 'ACCOUNT_NOT_IN_CHART',
    });
    expect(h.chart_reads).toHaveLength(0);
  });

  it('varios códigos malos salen TODOS en details.issues, no sólo el primero', async () => {
    const h = makeHarness('ORGANIZATION');
    h.setAccounts([{ code: '413505', accepts_entries: false }]);

    const error = await h.validator
      .assertAccountsUsable(
        configWithAccounting({
          revenue_account_by_bucket: {
            administracion: '413505', // existe pero es agrupación
            imprevistos: '543543', // no existe
            utilidad: '534534', // no existe
          },
        }) as any,
        SCOPE,
      )
      .catch((e) => e);

    expect(error.getResponse().details.issue_count).toBe(3);
    expect(error.getResponse().details.issues.map((i: any) => i.code)).toEqual([
      'ACCOUNT_DOES_NOT_ACCEPT_ENTRIES',
      'ACCOUNT_NOT_IN_CHART',
      'ACCOUNT_NOT_IN_CHART',
    ]);
  });
});
