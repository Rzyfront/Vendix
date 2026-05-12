export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidPassword(password: string): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (password.length < 8) {
    errors.push('La contraseña debe tener al menos 8 caracteres');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('La contraseña debe tener al menos una mayúscula');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('La contraseña debe tener al menos una minúscula');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('La contraseña debe tener al menos un número');
  }
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
