/**
 * Colombian NIT (Número de Identificación Tributaria) utilities.
 *
 * Implements the DIAN módulo 11 algorithm to compute and validate
 * the verification digit (dígito de verificación / DV) of a NIT.
 *
 * Reference: https://www.dian.gov.co
 */
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/**
 * Compute the verification digit for a Colombian NIT base number.
 *
 * @param nit Numeric NIT string without verification digit. Non-digit
 *            characters (dots, dashes, spaces) are stripped before computing.
 * @returns The verification digit (0-9) as a string, or `null` if input is empty.
 */
export function computeNitDv(nit: string | null | undefined): string | null {
  if (!nit) return null;
  const digits = String(nit).replace(/\D/g, '');
  if (!digits) return null;

  let sum = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    const d = Number(reversed[i]);
    const w = NIT_WEIGHTS[i] ?? 0;
    sum += d * w;
  }

  const mod = sum % 11;
  if (mod === 0 || mod === 1) return String(mod);
  return String(11 - mod);
}

/**
 * Validate that the verification digit matches the NIT base number.
 */
export function isValidNitDv(nit: string, dv: string | number): boolean {
  const expected = computeNitDv(nit);
  if (expected === null) return false;
  return String(dv) === expected;
}

/**
 * Fábrica del validador de GRUPO que verifica la coherencia NIT ↔ DV.
 *
 * El validador vive en el `FormGroup` (no en un control) porque compara dos
 * campos hermanos. Los nombres de esos campos NO son universales en la app:
 * los formularios fiscales usan `nit` / `nit_dv`, mientras que el formulario
 * de clientes usa `document_number` / `verification_digit`. Enganchar el
 * validador con los nombres equivocados no falla ni avisa — `control.get()`
 * devuelve `null`, el validador sale por la guarda de vacío y queda como un
 * no-op silencioso, dejando que el 400 del backend (`NitDvMatches`) sea el
 * primer aviso. Por eso los nombres se pasan explícitamente.
 *
 * El error incluye el DV esperado para que la UI pueda decir cuál es el
 * correcto en vez de limitarse a marcar el campo en rojo.
 */
export function nitDvGroupValidator(
  nitKey = 'nit',
  dvKey = 'nit_dv',
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const rawNit = control.get(nitKey)?.value;
    const dv = control.get(dvKey)?.value;
    if (!rawNit || dv === null || dv === undefined || dv === '') return null;
    // Un NIT escrito como `900123456-7` ya trae el DV pegado: sin recortarlo,
    // `computeNitDv` lo tomaría como parte de la base y marcaría un error
    // falso. Mismo criterio que `normalizeNit()` en el backend.
    const nit = String(rawNit).split('-')[0];
    if (!nit) return null;
    if (isValidNitDv(nit, String(dv))) return null;
    return { nitDv: { expected: computeNitDv(nit) } };
  };
}

/**
 * Angular validator that flags an invalid NIT+DV pair.
 *
 * Expects the control to be a `FormGroup` with two child controls:
 * `nit` and `nit_dv`. Adds `{ nitDv: { expected } }` to the group errors when
 * the verification digit does not match. Empty values pass through
 * (use Validators.required to enforce presence).
 */
export const nitDvValidator: ValidatorFn = nitDvGroupValidator();
