import {
  SETTINGS_TRANSITION_GUARDS,
  readSettingsPath,
  SettingsTransitionGuardDeps,
} from './settings-transition-guards';
import { ErrorCodes } from '@common/errors';

describe('readSettingsPath', () => {
  it('lee una ruta anidada existente', () => {
    expect(
      readSettingsPath({ pos: { cash_register: { enabled: true } } },
        'pos.cash_register.enabled'),
    ).toBe(true);
  });

  it('devuelve undefined cuando un tramo intermedio falta, sin lanzar', () => {
    expect(
      readSettingsPath({ pos: {} }, 'pos.cash_register.enabled'),
    ).toBeUndefined();
    expect(
      readSettingsPath(undefined, 'pos.cash_register.enabled'),
    ).toBeUndefined();
    expect(
      readSettingsPath({ pos: null }, 'pos.cash_register.enabled'),
    ).toBeUndefined();
  });
});

describe('SETTINGS_TRANSITION_GUARDS — pos.cash_register.enabled', () => {
  const guard = SETTINGS_TRANSITION_GUARDS.find(
    (g) => g.path === 'pos.cash_register.enabled',
  )!;

  const depsWith = (
    count: number,
    registers: { id: number; name: string }[] = [],
  ): SettingsTransitionGuardDeps => ({
    countOpenCashSessions: jest.fn().mockResolvedValue({ count, registers }),
  });

  it('está declarado para la transición true -> false con código 409', () => {
    expect(guard).toBeDefined();
    expect(guard.from).toBe(true);
    expect(guard.to).toBe(false);
    expect(guard.errorCode).toBe(ErrorCodes.CASH_REGISTER_DISABLE_001);
    expect(guard.errorCode.httpStatus).toBe(409);
  });

  it('no bloquea cuando no hay sesiones abiertas', async () => {
    const result = await guard.check(depsWith(0));
    expect(result.blocked).toBe(false);
  });

  it('bloquea cuando hay una sesión abierta y nombra la caja', async () => {
    const result = await guard.check(
      depsWith(1, [{ id: 19, name: 'Caja Principal' }]),
    );

    expect(result.blocked).toBe(true);
    expect(result.detail).toContain('1 sesión abierta');
    expect(result.detail).toContain('"Caja Principal"');
    expect(result.metadata).toEqual({
      open_sessions: 1,
      registers: [{ id: 19, name: 'Caja Principal' }],
    });
  });

  it('pluraliza y enumera todas las cajas cuando hay varias sesiones', async () => {
    const result = await guard.check(
      depsWith(3, [
        { id: 19, name: 'Caja Principal' },
        { id: 20, name: 'Caja 2' },
      ]),
    );

    expect(result.blocked).toBe(true);
    expect(result.detail).toContain('3 sesiones abiertas');
    expect(result.detail).toContain('"Caja Principal" y "Caja 2"');
  });
});
