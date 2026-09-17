import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { PosSearchPathService } from './pos-search-path.service';
import {
  POS_SMART_SEARCH_KILL_SWITCH_ENV,
  PosSearchPath,
  parseKillSwitch,
  resolveSearchPath,
  snapshotSearchPath,
} from './pos-search-path';

/**
 * CP-pos-smart-search · A.0 — cutover capability × kill-switch.
 *
 * Sin flags por tienda (removidos a pedido del dueño). Cubre: matriz
 * kill×capability, kill-switch global (F-007), capability probe (F-049) y
 * su caché TTL, y el snapshot de la línea estructurada (F-068).
 */

type MockPrisma = {
  $queryRaw: jest.Mock;
  withoutScope: jest.Mock;
};

function makeService() {
  const prisma: MockPrisma = {
    $queryRaw: jest.fn(),
    withoutScope: jest.fn(),
  };
  prisma.withoutScope.mockReturnValue({ $queryRaw: prisma.$queryRaw });
  // El kill-switch se lee de env real: los tests lo setean por proceso.
  const config = {
    get: jest.fn((key: string) => process.env[key]),
  } as unknown as ConfigService;

  const service = new PosSearchPathService(
    prisma as unknown as StorePrismaService,
    config,
  );
  const warnSpy = jest.spyOn(
    (service as unknown as { logger: Logger }).logger,
    'warn',
  );
  return { service, prisma, warnSpy };
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

describe('pos-search-path (pure)', () => {
  describe('resolveSearchPath — kill × capability', () => {
    const cases: Array<{
      name: string;
      kill: boolean;
      capable: boolean;
      expected: PosSearchPath;
    }> = [
      { name: 'kill on ⇒ legacy (aunque capaz)', kill: true, capable: true, expected: 'legacy' },
      { name: 'kill on ∧ ¬capable ⇒ legacy', kill: true, capable: false, expected: 'legacy' },
      { name: 'capable ⇒ trigram', kill: false, capable: true, expected: 'trigram' },
      { name: '¬capable ⇒ l2 (default diseñado)', kill: false, capable: false, expected: 'l2' },
    ];

    it.each(cases)('$name', ({ kill, capable, expected }) => {
      expect(resolveSearchPath(kill, { trigramCapable: capable })).toBe(
        expected,
      );
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

  it('snapshotSearchPath deja el hook B.2 listo (F-068)', () => {
    expect(snapshotSearchPath('l2', false, false)).toEqual({
      path: 'l2',
      trigram_capable: false,
      kill_switch: false,
    });
  });
});

describe('PosSearchPathService', () => {
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

  describe('kill-switch (F-007)', () => {
    it('env on ⇒ legacy sin tocar la DB, aunque capaz', async () => {
      process.env[ENV_KEY] = 'true';
      const { service, prisma } = makeService();

      expect(service.isKillSwitchOn()).toBe(true);
      await expect(service.resolveSearchPathFor()).resolves.toEqual({
        path: 'legacy',
        trigramCapable: false,
        killSwitch: true,
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('apagar el env surte efecto en el próximo request (sin TTL)', async () => {
      process.env[ENV_KEY] = '1';
      const { service, prisma } = makeService();
      prisma.$queryRaw.mockResolvedValue([probeRow()]);

      await expect(service.resolveSearchPathFor()).resolves.toMatchObject({
        path: 'legacy',
        killSwitch: true,
      });
      delete process.env[ENV_KEY];
      await expect(service.resolveSearchPathFor()).resolves.toMatchObject({
        path: 'trigram',
        killSwitch: false,
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
    it('capable ⇒ trigram, sin warn', async () => {
      const { service, prisma, warnSpy } = makeService();
      prisma.$queryRaw.mockResolvedValue([probeRow()]);

      await expect(service.resolveSearchPathFor()).resolves.toEqual({
        path: 'trigram',
        trigramCapable: true,
        killSwitch: false,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('¬capable ⇒ l2 SIN warn (default diseñado, no degradación)', async () => {
      const { service, prisma, warnSpy } = makeService();
      prisma.$queryRaw.mockResolvedValue([probeRow({ wrapper_ok: false })]);

      const resolution = await service.resolveSearchPathFor();

      expect(resolution.path).toBe('l2');
      expect(resolution.trigramCapable).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('kill-switch ⇒ legacy aunque capaz', async () => {
      process.env[ENV_KEY] = 'on';
      const { service, prisma } = makeService();

      const resolution = await service.resolveSearchPathFor();

      expect(resolution).toEqual({
        path: 'legacy',
        trigramCapable: false,
        killSwitch: true,
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
