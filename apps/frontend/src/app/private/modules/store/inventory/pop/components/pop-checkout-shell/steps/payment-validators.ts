import { AbstractControl } from '@angular/forms';

/** Fecha mínima viva (getter): se re-validó en cada cambio, no al crear el formulario. */
export function minDateValidator(getMin: () => string) {
  return (control: AbstractControl) => {
    const value: string = control.value;
    if (!value) return null;
    const min = getMin();
    return value < min ? { minDate: { min } } : null;
  };
}

/** Tope superior vivo (getter): el máximo se lee en cada validación (tope en vivo). */
export function maxValueValidator(getMax: () => number) {
  return (control: AbstractControl) => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return { max: { max: getMax() } };
    return n > getMax() ? { max: { max: getMax() } } : null;
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}