import { VendixHttpException } from 'src/common/errors';

import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

import {
  AIU_BUCKETS,
  AIU_TAXABLE_BUCKETS_BY_BASIS,
  AiuTaxableBasis,
  buildDefaultAiuProfileConfig,
} from './invoice-profile-config.contract';
import { ProfileAccountingValidator } from './profile-accounting.validator';
import { ProfilesService } from './profiles.service';

/**
 * SPEC NEGATIVA de la compuerta F.13 (DB-07).
 *
 * Lo que este archivo fija es el CONTRATO del guardado: un perfil cuyo PUC no
 * contiene alguna cuenta de su sección `accounting` —o la contiene como
 * agrupación— ya no se guarda, y las tres rutas que persisten configuración
 * (crear, editar, clonar) responden el MISMO `INVOICING_PROFILE_010` con el
 * campo exacto nombrado en `details.issues[].field`.
 *
 * Corre con el validador REAL y el FiscalScopeService REAL sobre red doblada:
 * stubear la compuerta aquí probaría sólo la propagación del error, no que el
 * guardado de verdad consulta `chart_of_accounts` antes de escribir.
 */
describe('ProfilesService — compuerta 422 de cuentas PUC al guardar (F.13)', () => {
  const ORG_ID = 6;
  const STORE_ID = 10;

  /** Config AIU válida bajo la base pedida, para que el fixture no se valide a sí mismo. */
  function aiuConfig(basis?: AiuTaxableBasis): Record<string, any> {
    const config: any = JSON.parse(
      JSON.stringify(buildDefaultAiuProfileConfig('Compuerta F.13')),
    );
    if (!basis) return config;
    config.aiu.taxable_basis = basis;
    const taxable = AIU_TAXABLE_BUCKETS_BY_BASIS[basis];
    config.taxes.rules = AIU_BUCKETS.map((bucket) => {
      const existing = config.taxes.rules.find((r: any) => r.bucket === bucket);
      const shouldBeTaxable = taxable.includes(bucket);
      return {
        bucket,
        tax_code: existing?.tax_code ?? '01',
        rate: shouldBeTaxable ? (existing?.rate ?? '19.00') : '0.00',
        taxable: shouldBeTaxable,
      };
    });
    return config;
  }

  function makeDelegate(result: unknown) {
    return {
      findFirst: jest.fn().mockResolvedValue(result),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(result),
      update: jest.fn().mockResolvedValue(result),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue(result),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
  }

  interface Harness {
    service: ProfilesService;
    accounts_gate: ProfileAccountingValidator;
    tx: any;
    transaction_mock: jest.Mock;
    setAccounts(rows: { code: string; accepts_entries: boolean }[]): void;
    /** El `config` que la versión de ORIGEN tiene guardado (lo lee `clone`). */
    setSourceConfig(config: Record<string, any>): void;
  }

  /**
   * @param profile_row el perfil vigente que `findFirst` scopeado devuelve
   *                    (para update/clone); create lo ignora.
   */
  function makeHarness(profile_row?: Record<string, any>): Harness {
    let account_rows: { code: string; accepts_entries: boolean }[] = [];

    const current = profile_row ?? {
      id: 7,
      organization_id: ORG_ID,
      store_id: STORE_ID,
      name: 'Vigilancia',
      operation_type: '09',
      state: 'active',
      is_default: false,
      current_version: 2,
      cloned_from_profile_id: null,
      cloned_from_version: null,
    };
    const created_row = { ...current, id: 8, current_version: 0 };
    let source_config: Record<string, any> = aiuConfig();

    const tx = {
      invoice_profiles: makeDelegate(created_row),
      invoice_profile_versions: makeDelegate({ id: 90, version: 1, config: source_config }),
    };
    tx.invoice_profiles.create = jest.fn().mockResolvedValue(created_row);
    tx.invoice_profiles.update =
      jest.fn().mockResolvedValue({ ...created_row, current_version: 1 });

    const remote = {
      organizations: {
        // La org 6 es de scope STORE: el PUC que gobierna los perfiles es el de
        // la entidad contable de la tienda 10.
        findUnique: jest.fn().mockResolvedValue({ fiscal_scope: 'STORE' }),
      },
      accounting_entities: {
        findFirst: jest.fn().mockResolvedValue({ id: 25 }),
      },
    };

    const scoped = {
      invoice_profiles: makeDelegate(current),
      invoice_profile_versions: {
        ...makeDelegate({ config: source_config }),
        // `readVersionConfig` (clonado) y `attachCurrentConfig` leen la versión
        // por acá; qué config trae el origen lo decide cada prueba.
        findFirst: jest.fn(() => Promise.resolve({ id: 90, version: 2, config: source_config })),
      },
      invoices: makeDelegate(null),
      chart_of_accounts: {
        findMany: jest.fn((args: any) =>
          Promise.resolve(
            account_rows.filter((row) => args?.where?.code?.in?.includes(row.code)),
          ),
        ),
      },
    };
    // `findByName` recorre perfiles con `findMany`; ninguna prueba de acá choca
    // por nombre, así que el delegate vacío por defecto sirve.
    scoped.invoice_profiles.findFirst = jest.fn().mockResolvedValue(current);

    const transaction_mock = jest.fn((cb: any) => cb(tx));
    const prisma = {
      ...scoped,
      withoutScope: jest.fn().mockReturnValue({ ...remote, $transaction: transaction_mock }),
    } as any;

    const fiscal_scope_service = new FiscalScopeService(prisma);
    const accounts_gate = new ProfileAccountingValidator(prisma, fiscal_scope_service);
    const cache = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    } as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new ProfilesService(prisma, cache, audit, accounts_gate);

    return {
      service,
      accounts_gate,
      tx,
      transaction_mock,
      setAccounts: (rows) => (account_rows = rows),
      setSourceConfig: (config) => (source_config = config),
    };
  }

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: ORG_ID, store_id: STORE_ID, user_id: 162 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  // ─── POST ──────────────────────────────────────────────────────────────

  it('POST con la cuenta inexistente 413501 responde 422 INVOICING_PROFILE_010 nombrando accounting.revenue_account_by_bucket.costo y no crea nada', async () => {
    const h = makeHarness();
    h.setAccounts([
      // El PUC real de la familia: 4135 es agrupación; las tres siguientes son
      // imputables. 413501 NO existe en ningún PUC (medido en DB-07).
      { code: '4135', accepts_entries: false },
      { code: '413505', accepts_entries: true },
      { code: '413510', accepts_entries: true },
      { code: '413515', accepts_entries: true },
    ]);
    const config = aiuConfig();
    config.accounting.revenue_account_by_bucket = {
      administracion: '413505',
      imprevistos: '413510',
      utilidad: '413515',
      costo: '413501', // el código que el propio plan enseñó por error
    };

    const error = await h.service
      .create({ name: 'AIU roto', operation_type: '09', config } as any)
      .catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse().error_code).toBe('INVOICING_PROFILE_010');
    expect(error.getResponse().details.issues).toEqual([
      expect.objectContaining({
        field: 'accounting.revenue_account_by_bucket.costo',
        code: 'ACCOUNT_NOT_IN_CHART',
      }),
    ]);
    // No se entra a la transacción: nada queda a medias.
    expect(h.transaction_mock).not.toHaveBeenCalled();
    expect(h.tx.invoice_profile_versions.create).not.toHaveBeenCalled();
  });

  it('POST con 413505 imputable en TODOS los buckets guarda y compromete la versión', async () => {
    const h = makeHarness();
    h.setAccounts([{ code: '413505', accepts_entries: true }]);
    const config = aiuConfig();
    config.accounting.revenue_account_by_bucket = {
      administracion: '413505',
      imprevistos: '413505',
      utilidad: '413505',
      costo: '413505',
    };
    config.accounting.vat_payable_account = null;

    await h.service.create({
      name: 'AIU sano',
      operation_type: '09',
      config,
    } as any);

    expect(h.tx.invoice_profile_versions.create).toHaveBeenCalledTimes(1);
    expect(h.tx.invoice_profiles.update).toHaveBeenCalled();
  });

  it('POST con la sección contable vacía (heredar mapeo) ni consulta el PUC', async () => {
    const h = makeHarness();

    await h.service.create({
      name: 'Heredado',
      operation_type: '09',
      config: aiuConfig(),
    } as any);

    expect(h.tx.invoice_profile_versions.create).toHaveBeenCalledTimes(1);
  });

  // ─── PATCH ─────────────────────────────────────────────────────────────

  it('PATCH con vat_payable_account inexistente responde 422 nombrando accounting.vat_payable_account', async () => {
    const h = makeHarness();
    h.setAccounts([]);

    const error = await h.service
      .update(7, {
        config: { ...aiuConfig(), accounting: { vat_payable_account: '999999' } },
      } as any)
      .catch((e) => e);

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse().error_code).toBe('INVOICING_PROFILE_010');
    expect(error.getResponse().details.issues).toEqual([
      expect.objectContaining({
        field: 'accounting.vat_payable_account',
        code: 'ACCOUNT_NOT_IN_CHART',
      }),
    ]);
    expect(h.transaction_mock).not.toHaveBeenCalled();
  });

  it('un PATCH que SÓLO renombra no corre la compuerta: las filas legadas inválidas siguen editables', async () => {
    const h = makeHarness();
    // El perfil legado lleva códigos que hoy no existirían; como el PATCH no
    // reenvía config, no nace versión nueva y la compuerta no aplica (decisión
    // F.13: marcar + corregir en UI, nunca bloquear la edición ajena).
    const gate_spy = jest.spyOn(h.accounts_gate, 'assertAccountsUsable');

    await h.service.update(7, { name: 'Vigilancia renombrada' } as any);

    expect(gate_spy).not.toHaveBeenCalled();
    expect(h.transaction_mock).toHaveBeenCalledTimes(1);
  });

  // ─── CLONADO ───────────────────────────────────────────────────────────

  it('clonar un perfil cuya config origen trae una cuenta inexistente falla con el MISMO código, y el clon no nace', async () => {
    const h = makeHarness();
    h.setAccounts([
      { code: '413505', accepts_entries: true },
      { code: '413510', accepts_entries: true },
    ]);

    // La config de la versión 2 del origen, con el teclazo errado en utilidad.
    const source_with_typo = aiuConfig();
    source_with_typo.accounting.revenue_account_by_bucket = {
      administracion: '413505',
      imprevistos: '413510',
      utilidad: '534534', // teclazo de prueba, medido en los perfiles 77/90
      costo: '413505',
    };
    h.setSourceConfig(source_with_typo);

    const error = await h.service
      .clone(7, { name: 'Vigilancia (copia)' } as any)
      .catch((e) => e);

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse().error_code).toBe('INVOICING_PROFILE_010');
    expect(error.getResponse().details.issues).toEqual([
      expect.objectContaining({
        field: 'accounting.revenue_account_by_bucket.utilidad',
        code: 'ACCOUNT_NOT_IN_CHART',
      }),
    ]);
    expect(h.transaction_mock).not.toHaveBeenCalled();
    expect(h.tx.invoice_profiles.create).not.toHaveBeenCalled();
  });
});
