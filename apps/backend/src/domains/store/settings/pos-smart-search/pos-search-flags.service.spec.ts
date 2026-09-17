import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AuditService } from '../../../../common/audit/audit.service';
import { PosSearchFlagsService } from './pos-search-flags.service';
import {
  POS_SEARCH_FLAGS_DEFAULT,
  POS_SEARCH_TOGGLE_AUDIT_ACTION,
  POS_SMART_SEARCH_KILL_SWITCH_ENV,
  PosSearchFlags,
  PosSearchPath,
  coerceSearchFlags,
  parseKillSwitch,
  resolveSearchPath,
  snapshotSearchFlags,
} from './pos-search-flags';

/**
 * CP-pos-smart-search · A.0 — flag infra two-tier + cutover.
 *
 * Cubre: matriz 8 estados (F-021), flag-down→legacy + warn (ERR-19, F-035),
 * kill-switch global (F-007), audit por toggle (F-071), capability probe
 * (F-049) y caché TTL + invalidación (F-051).
 */

const STORE_ID = 10;
const USER_ID = 15;
const ORG_ID = 3;

type MockPrisma = {
  store_settings: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
  withoutScope: jest.Mock;
};

function makeService() {
  const prisma: MockPrisma = {
    store_settings: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
    withoutScope: jest.fn(),
  };
  prisma.withoutScope.mockReturnValue({ $queryRaw: prisma.$queryRaw });
  // El kill-switch se lee de env real: los tests lo setean por proceso.
  const config = {
    get: jest.fn((key: string) => process.env[key]),
  } as unknown as ConfigService;
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  const service = new PosSearchFlagsService(
    prisma as unknown as StorePrismaService,
    config,
    audit as unknown as AuditService,
  );
  const warnSpy = jest.spyOn(
    (service as unknown as { logger: Logger }).logger,
    'warn',
  );
  return { service, prisma, audit, warnSpy };
}

function settingsRow(block: unknown) {
  return { store_id: STORE_ID, settings: { pos_smart_search: block } };
}

function probeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ext_count: BigInt(2),
    wrapper_ok: true,
    trgm_index_count: BigInt(2),
    invalid_count: BigInt(0),
    ...overrides,
  };
}

describe('pos-search-flags (pure)', () => {
  describe('resolveSearchPath — matriz 8 estados (F-021, F-049)', () => {
    const cases: Array<{
      name: string;
      flags: PosSearchFlags;
      capable: boolean;
      expected: PosSearchPath;
    }> = [
      { name: '#1 000 → legacy', flags: { l1: false, l2: false, trigram: false }, capable: false, expected: 'legacy' },
      { name: '#2 100 → l1 (orden legacy by design)', flags: { l1: true, l2: false, trigram: false }, capable: false, expected: 'l1' },
      { name: '#3 010 → l2 (L2⇒L1)', flags: { l1: false, l2: true, trigram: false }, capable: false, expected: 'l2' },
      { name: '#4 110 → l2', flags: { l1: true, l2: true, trigram: false }, capable: false, expected: 'l2' },
      { name: '#5 001∧capable → trigram', flags: { l1: false, l2: false, trigram: true }, capable: true, expected: 'trigram' },
      { name: '#5d 001∧¬capable → legacy', flags: { l1: false, l2: false, trigram: true }, capable: false, expected: 'legacy' },
      { name: '#6 101∧capable → trigram', flags: { l1: true, l2: false, trigram: true }, capable: true, expected: 'trigram' },
      { name: '#6d 101∧¬capable → l1', flags: { l1: true, l2: false, trigram: true }, capable: false, expected: 'l1' },
      { name: '#7 011∧capable → trigram', flags: { l1: false, l2: true, trigram: true }, capable: true, expected: 'trigram' },
      { name: '#7d 011∧¬capable → l2', flags: { l1: false, l2: true, trigram: true }, capable: false, expected: 'l2' },
      { name: '#8 111∧capable → trigram', flags: { l1: true, l2: true, trigram: true }, capable: true, expected: 'trigram' },
      { name: '#8d 111∧¬capable → l2', flags: { l1: true, l2: true, trigram: true }, capable: false, expected: 'l2' },
    ];

    it.each(cases)('$name', ({ flags, capable, expected }) => {
      expect(resolveSearchPath(flags, { trigramCapable: capable })).toBe(
        expected,
      );
    });
  });

  describe('coerceSearchFlags — solo `true` explícito enciende (F-035)', () => {
    it.each([undefined, null, 42, 'on', [], new Date()])(
      'no-objeto (%p) ⇒ default-off',
      (raw) => {
        expect(coerceSearchFlags(raw)).toEqual(POS_SEARCH_FLAGS_DEFAULT);
      },
    );

    it('bloque ausente/vacío ⇒ todo off', () => {
      expect(coerceSearchFlags({})).toEqual({
        l1: false,
        l2: false,
        trigram: false,
      });
    });

    it('truthy no-booleanos NO encienden', () => {
      expect(coerceSearchFlags({ l1: 1, l2: 'true', trigram: {} })).toEqual({
        l1: false,
        l2: false,
        trigram: false,
      });
    });

    it('`true` explícitos sí encienden, por clave', () => {
      expect(coerceSearchFlags({ l1: true })).toEqual({
        l1: true,
        l2: false,
        trigram: false,
      });
    });
  });

  describe('parseKillSwitch', () => {
    it.each(['1', 'true', 'TRUE', ' yes ', 'on', 'ON'])(
      'truthy %p ⇒ on',
      (value) => {
        expect(parseKillSwitch(value)).toBe(true);
      },
    );

    it.each([undefined, '', '0', 'false', 'off', 'quizás'])(
      '%p ⇒ off',
      (value) => {
        expect(parseKillSwitch(value)).toBe(false);
      },
    );
  });

  it('snapshotSearchFlags deja el hook B.2 listo (F-068/F-071)', () => {
    expect(
      snapshotSearchFlags(
        { l1: true, l2: true, trigram: false },
        'l2',
      ),
    ).toEqual({ l1: true, l2: true, trigram: false, path: 'l2' });
  });
});

describe('PosSearchFlagsService', () => {
  const ENV_KEY = POS_SMART_SEARCH_KILL_SWITCH_ENV;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEnv;
    jest.restoreAllMocks();
  });

  describe('resolveSearchFlags — never-throw + caché (ERR-19, F-035, F-051)', () => {
    it('lee flags de store_settings y cachea: 2 llamadas ⇒ 1 select', async () => {
      const { service, prisma } = makeService();
      prisma.store_settings.findFirst.mockResolvedValue(
        settingsRow({ l1: true }),
      );

      const first = await service.resolveSearchFlags(STORE_ID);
      const second = await service.resolveSearchFlags(STORE_ID);

      expect(first).toEqual({ l1: true, l2: false, trigram: false });
      expect(second).toEqual(first);
      expect(prisma.store_settings.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.store_settings.findFirst).toHaveBeenCalledWith({
        where: { store_id: STORE_ID },
        select: { settings: true },
      });
    });

    it('invalidateStore fuerza relectura en el próximo request', async () => {
      const { service, prisma } = makeService();
      prisma.store_settings.findFirst
        .mockResolvedValueOnce(settingsRow({ l1: false }))
        .mockResolvedValueOnce(settingsRow({ l1: true }));

      expect(await service.resolveSearchFlags(STORE_ID)).toEqual({
        l1: false,
        l2: false,
        trigram: false,
      });
      service.invalidateStore(STORE_ID);
      expect(await service.resolveSearchFlags(STORE_ID)).toEqual({
        l1: true,
        l2: false,
        trigram: false,
      });
      expect(prisma.store_settings.findFirst).toHaveBeenCalledTimes(2);
    });

    it('fila ausente ⇒ default-off sin throw', async () => {
      const { service, prisma, warnSpy } = makeService();
      prisma.store_settings.findFirst.mockResolvedValue(null);

      await expect(service.resolveSearchFlags(STORE_ID)).resolves.toEqual(
        POS_SEARCH_FLAGS_DEFAULT,
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('ERR-19: fuente caída ⇒ legacy (default-off) + warn log, grid intacta', async () => {
      const { service, prisma, warnSpy } = makeService();
      prisma.store_settings.findFirst.mockRejectedValue(
        new Error('connection refused'),
      );

      await expect(service.resolveSearchFlags(STORE_ID)).resolves.toEqual(
        POS_SEARCH_FLAGS_DEFAULT,
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(`storeId=${STORE_ID}`);
    });

    it('no cachea el fallo: reintenta en el próximo request', async () => {
      const { service, prisma } = makeService();
      prisma.store_settings.findFirst
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(settingsRow({ l2: true }));

      await expect(service.resolveSearchFlags(STORE_ID)).resolves.toEqual(
        POS_SEARCH_FLAGS_DEFAULT,
      );
      await expect(service.resolveSearchFlags(STORE_ID)).resolves.toEqual({
        l1: false,
        l2: true,
        trigram: false,
      });
      expect(prisma.store_settings.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('kill-switch Tier-0 (F-007)', () => {
    it('env on ⇒ legacy sin tocar la DB, aunque haya flags on', async () => {
      process.env[ENV_KEY] = 'true';
      const { service, prisma } = makeService();
      prisma.store_settings.findFirst.mockResolvedValue(
        settingsRow({ l1: true, l2: true, trigram: true }),
      );

      expect(service.isKillSwitchOn()).toBe(true);
      await expect(service.resolveSearchFlags(STORE_ID)).resolves.toEqual(
        POS_SEARCH_FLAGS_DEFAULT,
      );
      expect(prisma.store_settings.findFirst).not.toHaveBeenCalled();
    });

    it('apagar el env surte efecto en el próximo request (no espera TTL)', async () => {
      process.env[ENV_KEY] = '1';
      const { service, prisma } = makeService();
      prisma.store_settings.findFirst.mockResolvedValue(
        settingsRow({ l1: true }),
      );

      await expect(service.resolveSearchFlags(STORE_ID)).resolves.toEqual(
        POS_SEARCH_FLAGS_DEFAULT,
      );
      delete process.env[ENV_KEY];
      await expect(service.resolveSearchFlags(STORE_ID)).resolves.toEqual({
        l1: true,
        l2: false,
        trigram: false,
      });
    });
  });

  describe('isTrigramCapable — probe cacheada (F-049)', () => {
    it('ext×2 ∧ wrapper ∧ GIN ∧ cero inválidos ⇒ true', async () => {
      const { service, prisma } = makeService();
      prisma.$queryRaw.mockResolvedValue([probeRow()]);

      await expect(service.isTrigramCapable()).resolves.toBe(true);
    });

    it.each([
      ['falta una extensión', { ext_count: BigInt(1) }],
      ['wrapper ausente (pre-C.1)', { wrapper_ok: false }],
      ['sin GIN trigram (pre-C.2)', { trgm_index_count: BigInt(0) }],
      ['índice products inválido', { invalid_count: BigInt(1) }],
    ])('%s ⇒ false', async (_name, overrides) => {
      const { service, prisma } = makeService();
      prisma.$queryRaw.mockResolvedValue([probeRow(overrides)]);

      await expect(service.isTrigramCapable()).resolves.toBe(false);
    });

    it('probe caída ⇒ false + warn, nunca throw', async () => {
      const { service, prisma, warnSpy } = makeService();
      prisma.$queryRaw.mockRejectedValue(new Error('permission denied'));

      await expect(service.isTrigramCapable()).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('cachea: 2 llamadas ⇒ 1 probe', async () => {
      const { service, prisma } = makeService();
      prisma.$queryRaw.mockResolvedValue([probeRow()]);

      await service.isTrigramCapable();
      await service.isTrigramCapable();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveSearchPathFor — cutover por request', () => {
    it('trigram ∧ capable ⇒ trigram, sin warn', async () => {
      const { service, prisma, warnSpy } = makeService();
      prisma.store_settings.findFirst.mockResolvedValue(
        settingsRow({ l1: true, l2: true, trigram: true }),
      );
      prisma.$queryRaw.mockResolvedValue([probeRow()]);

      await expect(service.resolveSearchPathFor(STORE_ID)).resolves.toEqual({
        flags: { l1: true, l2: true, trigram: true },
        trigramCapable: true,
        killSwitch: false,
        path: 'trigram',
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('trigram ∧ ¬capable ⇒ fallback L2 + warn (fila 8d)', async () => {
      const { service, prisma, warnSpy } = makeService();
      prisma.store_settings.findFirst.mockResolvedValue(
        settingsRow({ l1: true, l2: true, trigram: true }),
      );
      prisma.$queryRaw.mockResolvedValue([probeRow({ wrapper_ok: false })]);

      const resolution = await service.resolveSearchPathFor(STORE_ID);

      expect(resolution.path).toBe('l2');
      expect(resolution.trigramCapable).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('fallback path=l2');
    });

    it('kill-switch ⇒ legacy aunque todo esté on y capaz', async () => {
      process.env[ENV_KEY] = 'on';
      const { service, prisma } = makeService();

      const resolution = await service.resolveSearchPathFor(STORE_ID);

      expect(resolution).toEqual({
        flags: POS_SEARCH_FLAGS_DEFAULT,
        trigramCapable: false,
        killSwitch: true,
        path: 'legacy',
      });
      expect(prisma.store_settings.findFirst).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('auditToggles — una fila por flag cambiado (F-071)', () => {
    it('escribe actor, key, old→new, scope y ts por cada cambio', async () => {
      const { service, audit } = makeService();

      await service.auditToggles({
        userId: USER_ID,
        storeId: STORE_ID,
        organizationId: ORG_ID,
        before: { l1: false, l2: true, trigram: false },
        after: { l1: true, l2: true, trigram: true },
      });

      expect(audit.log).toHaveBeenCalledTimes(2);
      expect(audit.log).toHaveBeenNthCalledWith(1, {
        userId: USER_ID,
        storeId: STORE_ID,
        organizationId: ORG_ID,
        action: POS_SEARCH_TOGGLE_AUDIT_ACTION,
        resource: 'settings',
        oldValues: { key: 'l1', value: false },
        newValues: { key: 'l1', value: true },
        metadata: {
          scope: 'store',
          store_id: STORE_ID,
          section: 'pos_smart_search',
          key: 'l1',
        },
      });
      expect(audit.log).toHaveBeenNthCalledWith(2, {
        userId: USER_ID,
        storeId: STORE_ID,
        organizationId: ORG_ID,
        action: POS_SEARCH_TOGGLE_AUDIT_ACTION,
        resource: 'settings',
        oldValues: { key: 'trigram', value: false },
        newValues: { key: 'trigram', value: true },
        metadata: {
          scope: 'store',
          store_id: STORE_ID,
          section: 'pos_smart_search',
          key: 'trigram',
        },
      });
    });

    it('sin cambios ⇒ cero filas', async () => {
      const { service, audit } = makeService();
      const same: PosSearchFlags = { l1: true, l2: false, trigram: false };

      await service.auditToggles({
        userId: USER_ID,
        storeId: STORE_ID,
        before: same,
        after: { ...same },
      });

      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});
