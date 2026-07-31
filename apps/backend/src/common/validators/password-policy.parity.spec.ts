import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  describeMissingPasswordRules,
  failedPasswordRules,
  isStrongPassword,
  passwordPolicyMessage,
} from './password-policy';

/**
 * La política de contraseñas vive replicada en tres runtimes (Nest, Angular,
 * React Native) porque no hay paquete compartido ejecutable entre ellos:
 * `libs/shared-types` solo publica declaraciones. Este test es el candado que
 * evita que los espejos vuelvan a divergir —que es exactamente el bug que
 * originó la unificación: el mismo password válido en un formulario e inválido
 * en otro.
 */

const MIRRORS = [
  {
    name: 'frontend',
    path: join(
      __dirname,
      '../../../../frontend/src/app/core/utils/password-policy.ts',
    ),
  },
  {
    name: 'mobile',
    path: join(__dirname, '../../../../mobile/src/core/utils/password-policy.ts'),
  },
];

/** `id: 'symbol',` → `symbol` (en orden de aparición). */
function extractRuleIds(source: string): string[] {
  return [...source.matchAll(/^\s*id: '([a-zA-Z]+)',$/gm)].map((m) => m[1]);
}

/** `test: (value) => /[a-z]/.test(value),` → cuerpo normalizado sin espacios. */
function extractRuleTests(source: string): string[] {
  return [...source.matchAll(/^\s*test: \(value\) =>\s*([^\n]+?),\s*$/gm)].map(
    (m) => m[1].replace(/\s+/g, ''),
  );
}

function extractConstant(source: string, name: string): string | null {
  const match = source.match(new RegExp(`export const ${name} = (\\d+);`));
  return match ? match[1] : null;
}

describe('password policy — comportamiento', () => {
  it('acepta un password con símbolo no alfanumérico cualquiera', () => {
    // El caso que el regex `[@$!%*?&]` rechazaba: punto como símbolo.
    expect(isStrongPassword('Rafa1234.')).toBe(true);
    expect(isStrongPassword('Rafa1234-')).toBe(true);
    expect(isStrongPassword('Rafa1234_')).toBe(true);
    expect(isStrongPassword('Rafa1234@')).toBe(true);
  });

  it('rechaza y enumera cada requisito incumplido', () => {
    expect(failedPasswordRules('rafa1234.')).toEqual(['uppercase']);
    expect(failedPasswordRules('RAFA1234.')).toEqual(['lowercase']);
    expect(failedPasswordRules('Rafaelito.')).toEqual(['number']);
    expect(failedPasswordRules('Rafa12345')).toEqual(['symbol']);
    expect(failedPasswordRules('Ra1.')).toEqual(['minLength']);
    expect(failedPasswordRules('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toEqual([
      'uppercase',
      'number',
      'symbol',
      'maxLength',
    ]);
  });

  it('rechaza valores no string sin lanzar', () => {
    expect(isStrongPassword(undefined)).toBe(false);
    expect(isStrongPassword(null)).toBe(false);
    expect(isStrongPassword(12345678)).toBe(false);
  });

  it('redacta el mensaje enumerando lo que falta', () => {
    expect(passwordPolicyMessage('rafa1234')).toBe(
      'La contraseña debe tener una letra mayúscula y un símbolo.',
    );
    expect(passwordPolicyMessage('Rafa1234')).toBe(
      'La contraseña debe tener un símbolo.',
    );
    expect(describeMissingPasswordRules([])).toBe(
      'La contraseña no cumple la política.',
    );
  });
});

describe('password policy — paridad entre runtimes', () => {
  const backendIds = PASSWORD_RULES.map((rule) => rule.id);

  for (const mirror of MIRRORS) {
    // El Dockerfile del backend copia solo `apps/backend`, así que en esa
    // imagen los espejos no existen: ahí el test no aplica en vez de fallar.
    const describeOrSkip = existsSync(mirror.path) ? describe : describe.skip;

    describeOrSkip(`espejo ${mirror.name}`, () => {
      const source = existsSync(mirror.path)
        ? readFileSync(mirror.path, 'utf8')
        : '';

      it('declara las mismas reglas en el mismo orden', () => {
        expect(extractRuleIds(source)).toEqual(backendIds);
      });

      it('implementa cada regla con la misma condición', () => {
        expect(extractRuleTests(source)).toEqual(
          extractRuleTests(
            readFileSync(join(__dirname, 'password-policy.ts'), 'utf8'),
          ),
        );
      });

      it('usa los mismos límites de longitud', () => {
        expect(extractConstant(source, 'PASSWORD_MIN_LENGTH')).toBe(
          String(PASSWORD_MIN_LENGTH),
        );
        expect(extractConstant(source, 'PASSWORD_MAX_LENGTH')).toBe(
          String(PASSWORD_MAX_LENGTH),
        );
      });
    });
  }
});
