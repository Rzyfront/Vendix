import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Valida un teléfono de contacto contando sus dígitos, independiente de los
 * caracteres cosméticos (+, espacios, paréntesis, guiones) que el input ya
 * permite. Las líneas fijas en Colombia tienen 7 dígitos y los móviles 10;
 * permitimos 7–15 para cubrir formatos locales e internacionales sin ser
 * demasiado restrictivos. El caso vacío lo gestiona `Validators.required`.
 */
export function phoneDigitsValidator(min = 7, max = 15): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = (control.value ?? '').toString();
    if (!raw.trim()) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length < min || digits.length > max) {
      return { phoneDigits: { min, max, actual: digits.length } };
    }
    return null;
  };
}
