/**
 * FUENTE DE LA VERDAD de la política de contraseñas de la app móvil.
 *
 * Espejo exacto de:
 *   - `apps/frontend/src/app/core/utils/password-policy.ts`
 *   - `apps/backend/src/common/validators/password-policy.ts`
 *
 * Cualquier cambio debe replicarse en los tres; el test de paridad del backend
 * (`password-policy.parity.spec.ts`) falla si divergen. No hay paquete runtime
 * compartido porque los tres corren en toolchains distintas (Angular, Nest,
 * React Native) y `libs/shared-types` es solo declaraciones de tipos.
 */

export const PASSWORD_MIN_LENGTH = 8;

/** bcrypt trunca silenciosamente a 72 bytes. */
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordRuleId =
  | 'minLength'
  | 'lowercase'
  | 'uppercase'
  | 'number'
  | 'symbol'
  | 'maxLength';

export interface PasswordRule {
  readonly id: PasswordRuleId;
  /** Texto afirmativo del checklist. */
  readonly label: string;
  /** Fragmento para componer el mensaje de error. */
  readonly missing: string;
  /** `false` para reglas que solo tienen sentido al violarse. */
  readonly checklist: boolean;
  readonly test: (value: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'minLength',
    label: `Mínimo ${PASSWORD_MIN_LENGTH} caracteres`,
    missing: `${PASSWORD_MIN_LENGTH} caracteres como mínimo`,
    checklist: true,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'lowercase',
    label: 'Una letra minúscula',
    missing: 'una letra minúscula',
    checklist: true,
    test: (value) => /[a-z]/.test(value),
  },
  {
    id: 'uppercase',
    label: 'Una letra mayúscula',
    missing: 'una letra mayúscula',
    checklist: true,
    test: (value) => /[A-Z]/.test(value),
  },
  {
    id: 'number',
    label: 'Un número',
    missing: 'un número',
    checklist: true,
    test: (value) => /[0-9]/.test(value),
  },
  {
    // Cualquier carácter no alfanumérico: una lista blanca rechazaría símbolos
    // legítimos como el punto o el guion.
    id: 'symbol',
    label: 'Un símbolo (. , - _ ! @ …)',
    missing: 'un símbolo',
    checklist: true,
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
  {
    id: 'maxLength',
    label: `Máximo ${PASSWORD_MAX_LENGTH} caracteres`,
    missing: `máximo ${PASSWORD_MAX_LENGTH} caracteres`,
    checklist: false,
    test: (value) => value.length <= PASSWORD_MAX_LENGTH,
  },
];

/** Reglas que deben mostrarse siempre mientras el usuario escribe. */
export const PASSWORD_CHECKLIST_RULES: readonly PasswordRule[] =
  PASSWORD_RULES.filter((rule) => rule.checklist);

export interface PasswordRuleState {
  readonly rule: PasswordRule;
  readonly satisfied: boolean;
}

/** Estado regla por regla, para pintar un checklist en vivo. */
export function evaluatePassword(
  value: string | null | undefined,
): PasswordRuleState[] {
  const password = value ?? '';
  return PASSWORD_RULES.map((rule) => ({
    rule,
    satisfied: rule.test(password),
  }));
}

export function failedPasswordRules(
  value: string | null | undefined,
): PasswordRuleId[] {
  const password = value ?? '';
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map(
    (rule) => rule.id,
  );
}

export function isStrongPassword(value: string | null | undefined): boolean {
  return failedPasswordRules(value).length === 0;
}

export function describeMissingPasswordRules(
  failed: readonly PasswordRuleId[],
): string {
  const fragments = PASSWORD_RULES.filter((rule) =>
    failed.includes(rule.id),
  ).map((rule) => rule.missing);

  if (!fragments.length) {
    return '';
  }

  if (fragments.length === 1) {
    return `La contraseña debe tener ${fragments[0]}.`;
  }

  const last = fragments[fragments.length - 1];
  const head = fragments.slice(0, -1).join(', ');
  return `La contraseña debe tener ${head} y ${last}.`;
}
