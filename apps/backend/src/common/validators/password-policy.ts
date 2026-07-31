import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * FUENTE DE LA VERDAD de la política de contraseñas del backend.
 *
 * Antes convivían cuatro reglas distintas: `validatePasswordStrength()` en
 * `auth.service` (sin símbolo), un `@Matches` con la lista blanca `[@$!%*?&]`
 * que rechazaba el punto, un `@Matches(/[A-Z]/)` suelto y una decena de DTOs con
 * solo `@MinLength(8)`. El mismo password pasaba un endpoint y fallaba en otro.
 *
 * Espejos con la MISMA tabla de reglas —cualquier cambio aquí debe replicarse:
 *   - `apps/frontend/src/app/core/utils/password-policy.ts`
 *   - `apps/mobile/src/core/utils/password-policy.ts`
 * `password-policy.parity.spec.ts` falla si divergen.
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
  /** Texto afirmativo del requisito. */
  readonly label: string;
  /** Fragmento para componer el mensaje de error. */
  readonly missing: string;
  readonly test: (value: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'minLength',
    label: `Mínimo ${PASSWORD_MIN_LENGTH} caracteres`,
    missing: `${PASSWORD_MIN_LENGTH} caracteres como mínimo`,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'lowercase',
    label: 'Una letra minúscula',
    missing: 'una letra minúscula',
    test: (value) => /[a-z]/.test(value),
  },
  {
    id: 'uppercase',
    label: 'Una letra mayúscula',
    missing: 'una letra mayúscula',
    test: (value) => /[A-Z]/.test(value),
  },
  {
    id: 'number',
    label: 'Un número',
    missing: 'un número',
    test: (value) => /[0-9]/.test(value),
  },
  {
    // Cualquier carácter no alfanumérico. Una lista blanca de símbolos
    // (`@$!%*?&`) es lo que rechazaba contraseñas legítimas con punto o guion.
    id: 'symbol',
    label: 'Un símbolo (. , - _ ! @ …)',
    missing: 'un símbolo',
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
  {
    id: 'maxLength',
    label: `Máximo ${PASSWORD_MAX_LENGTH} caracteres`,
    missing: `máximo ${PASSWORD_MAX_LENGTH} caracteres`,
    test: (value) => value.length <= PASSWORD_MAX_LENGTH,
  },
];

export function failedPasswordRules(value: unknown): PasswordRuleId[] {
  if (typeof value !== 'string') {
    return PASSWORD_RULES.map((rule) => rule.id);
  }

  return PASSWORD_RULES.filter((rule) => !rule.test(value)).map(
    (rule) => rule.id,
  );
}

/** Predicado único de fortaleza. Sustituye a `validatePasswordStrength()`. */
export function isStrongPassword(value: unknown): boolean {
  return failedPasswordRules(value).length === 0;
}

/** "La contraseña debe tener una letra mayúscula y un símbolo." */
export function describeMissingPasswordRules(
  failed: readonly PasswordRuleId[],
): string {
  const fragments = PASSWORD_RULES.filter((rule) =>
    failed.includes(rule.id),
  ).map((rule) => rule.missing);

  if (!fragments.length) {
    return 'La contraseña no cumple la política.';
  }

  if (fragments.length === 1) {
    return `La contraseña debe tener ${fragments[0]}.`;
  }

  const last = fragments[fragments.length - 1];
  const head = fragments.slice(0, -1).join(', ');
  return `La contraseña debe tener ${head} y ${last}.`;
}

/** Mensaje listo para devolver al cliente ante un password débil. */
export function passwordPolicyMessage(value: unknown): string {
  return describeMissingPasswordRules(failedPasswordRules(value));
}

/**
 * Restricción class-validator. El mensaje enumera los requisitos incumplidos en
 * vez del genérico "formato inválido", igual que el checklist del frontend.
 */
@ValidatorConstraint({ name: 'IsStrongPassword', async: false })
export class IsStrongPasswordConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    return isStrongPassword(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return passwordPolicyMessage(args.value);
  }
}

/**
 * Valida la política única sobre una propiedad de contraseña.
 *
 * Combinar con `@IsOptional()` cuando el campo sea opcional (por ejemplo, un
 * update donde vacío significa "no cambiar").
 */
export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsStrongPasswordConstraint,
    });
  };
}
