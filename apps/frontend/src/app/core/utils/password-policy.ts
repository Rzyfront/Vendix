import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * FUENTE DE LA VERDAD de la política de contraseñas del frontend web.
 *
 * Antes de este archivo convivían cinco políticas distintas (un regex monolítico
 * `[@$!%*?&]` que rechazaba el punto, un `passwordValidator` sin minúscula ni
 * número, un `passwordStrengthValidator` completo, `Validators.minLength(8)` a
 * secas y un checklist propio en el auth-modal). El mismo password era válido en
 * un formulario e inválido en otro.
 *
 * Espejos con la MISMA tabla de reglas —cualquier cambio aquí debe replicarse:
 *   - `apps/backend/src/common/validators/password-policy.ts`
 *   - `apps/mobile/src/core/utils/password-policy.ts`
 * El test `password-policy.parity.spec.ts` del backend falla si divergen.
 */

export const PASSWORD_MIN_LENGTH = 8;

/**
 * bcrypt trunca silenciosamente a 72 bytes: aceptar más largo daría una falsa
 * sensación de entropía extra que el hash nunca almacena.
 */
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
  /** Texto afirmativo del checklist ("Mínimo 8 caracteres"). */
  readonly label: string;
  /** Fragmento para componer "Falta: una mayúscula, un símbolo". */
  readonly missing: string;
  /**
   * `false` para reglas que solo tienen sentido al violarse: listar "máximo 72
   * caracteres" junto a los requisitos por cumplir confunde más de lo que ayuda.
   */
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
    // Cualquier carácter no alfanumérico. Una lista blanca de símbolos
    // (`@$!%*?&`) es lo que rechazaba contraseñas legítimas con punto o guion.
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

/** Reglas que el usuario debe ver siempre mientras escribe. */
export const PASSWORD_CHECKLIST_RULES: readonly PasswordRule[] =
  PASSWORD_RULES.filter((rule) => rule.checklist);

export interface PasswordRuleState {
  readonly rule: PasswordRule;
  readonly satisfied: boolean;
}

/** Estado regla por regla, para pintar el checklist en vivo. */
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

export function isPasswordValid(value: string | null | undefined): boolean {
  return failedPasswordRules(value).length === 0;
}

/** "Falta una letra mayúscula y un símbolo." */
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

export interface PasswordPolicyError {
  readonly failed: PasswordRuleId[];
  readonly message: string;
}

/**
 * Validador único para TODO formulario que fije o cambie una contraseña.
 *
 * Emite la clave `passwordPolicy` con el detalle de lo que falta —a diferencia
 * de `Validators.pattern`, cuya clave `pattern` solo permite decir "formato
 * inválido" sin indicar el requisito incumplido.
 *
 * Vacío devuelve `null`: la obligatoriedad la decide `Validators.required`.
 */
export const passwordPolicyValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;

  if (value === null || value === undefined || value === '') {
    return null;
  }

  const failed = failedPasswordRules(String(value));

  if (!failed.length) {
    return null;
  }

  const error: PasswordPolicyError = {
    failed,
    message: describeMissingPasswordRules(failed),
  };

  return { passwordPolicy: error };
};

/**
 * Validador cruzado de confirmación. Se aplica al FormGroup.
 *
 * @param passwordKey control con la contraseña nueva
 * @param confirmKey control de confirmación
 */
export function createPasswordsMatchValidator(
  passwordKey: string,
  confirmKey: string,
): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const password = group.get(passwordKey)?.value;
    const confirm = group.get(confirmKey)?.value;

    if (!password || !confirm) {
      return null;
    }

    return password === confirm ? null : { passwordsMismatch: true };
  };
}
