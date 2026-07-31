import { evaluatePassword } from './password-policy';

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Delega en la política única (`core/utils/password-policy`). La versión previa
 * no exigía símbolo, así que aceptaba contraseñas que el backend rechazaba.
 */
export function isValidPassword(password: string): {
  isValid: boolean;
  errors: string[];
} {
  const errors = evaluatePassword(password)
    .filter((state) => !state.satisfied)
    .map((state) => `La contraseña debe tener ${state.rule.missing}`);

  return { isValid: errors.length === 0, errors };
}

export function isValidColombianDocument(doc: string): boolean {
  const cleaned = doc.replace(/\D/g, '');
  return cleaned.length >= 8 && cleaned.length <= 10;
}

export function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 13;
}

export function isRequired(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim().length > 0;
}

export function minLength(value: string, min: number): boolean {
  return value.length >= min;
}

export function maxLength(value: string, max: number): boolean {
  return value.length <= max;
}
