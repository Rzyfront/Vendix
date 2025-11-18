import { AbstractControl, ValidationErrors } from '@angular/forms';

export function passwordValidator(
  control: AbstractControl,
): ValidationErrors | null {
  const value = control.value;

  if (!value) {
    return null;
  }

  const errors: any = {};

  if (value.length < 8) {
    errors.minLength = { requiredLength: 8, actualLength: value.length };
  }

  if (!/[A-Z]/.test(value)) {
    errors.uppercase = true;
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    errors.specialChar = true;
  }

  return Object.keys(errors).length ? errors : null;
}
