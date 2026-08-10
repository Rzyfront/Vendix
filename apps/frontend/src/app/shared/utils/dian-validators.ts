import {
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

/**
 * Validadores del formulario de configuración DIAN, COMPARTIDOS por las cuatro
 * puertas de entrada.
 *
 * POR QUÉ SE MOVIERON ACÁ
 *
 * Existían solo en el riel de plataforma (`platform-invoicing.constants.ts`), que
 * es la superficie de MENOR riesgo: un operador interno de Vendix, una sola
 * configuración. Las tres que sí usan los comerciantes —el asistente de tienda, el
 * host de tenant que lo incrusta, y el formulario del asistente de activación
 * fiscal— tenían entre cuatro y siete `Validators.required` pelados y ningún
 * validador de formato.
 *
 * Eso deja la validación invertida respecto al riesgo. Un `software_id` con un
 * espacio de más no lo rechaza nadie en el navegador: el backend contesta 400 con
 * `@IsUUID` si el campo llega a esa ruta, y si llega a la DIAN el documento nunca
 * clasifica, lo que es indistinguible de una cola atascada. En el set de pruebas
 * eso cuesta consecutivos autorizados irrecuperables.
 *
 * REGLA: estos validadores son el espejo del DTO del backend. Si el DTO cambia,
 * cambian acá — no se añade una copia en el formulario de turno.
 */

// ── Identificadores ────────────────────────────────────────────────────────

/** IDs de entidad: enteros positivos. Un `0` o un `-1` no referencian nada. */
export const numericIdValidator = Validators.pattern(/^[1-9]\d*$/);

/** Igual, pero admite vacío: para ids que el backend deriva si no se envían. */
export const optionalNumericIdValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return /^[1-9]\d*$/.test(String(value)) ? null : { numeric_id: true };
};

/**
 * La DIAN emite `software_id` y `test_set_id` como UUID.
 *
 * Un valor pegado con un espacio de más lo acepta el endpoint DIAN y luego nunca
 * clasifica, lo que es indistinguible de una cola atascada. El backend ya valida
 * con `@IsUUID`; esto lo adelanta al formulario en vez de esperar un 400.
 *
 * Acepta cualquier versión de UUID a propósito: el DTO del backend usa
 * `@IsUUID(undefined)`, y exigir v4 acá rechazaría un identificador que la DIAN sí
 * emitió. El espejo del DTO manda.
 */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const dianUuidValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return UUID_RE.test(String(value).trim()) ? null : { dian_uuid: true };
};

/**
 * Forma del NIT: viaja a la DIAN sin separadores, y se admite el DV pegado con
 * guion porque es como lo imprime el RUT.
 *
 * COMPLEMENTA a `nitDvValidator` de `nit.util.ts`, no lo reemplaza: este valida la
 * FORMA y el otro valida que el dígito de verificación sea el correcto. Un NIT con
 * forma válida y DV equivocado hace que la DIAN rechace cada documento, así que los
 * dos van juntos en el control del NIT.
 */
export const nitFormatValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return /^\d{5,15}(-\d)?$/.test(String(value).trim())
    ? null
    : { nit_format: true };
};

/**
 * El PIN del software DIAN.
 *
 * Es numérico y corto, y entra en el campo 14 del CUDE de las notas. Un PIN mal
 * copiado produce un CUDE que la DIAN recomputa distinto y rechaza el documento con
 * el consecutivo ya gastado — el mismo modo de fallo que costó el racimo
 * `DAD06`/`DAU02/04/06` en el set de habilitación.
 *
 * Admite el centinela `****` con el que la API representa un secreto ya guardado:
 * bloquearlo obligaría a reescribir el PIN en cada edición del formulario.
 */
export const MASKED_SECRET = '****';

export const dianSoftwarePinValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (raw === MASKED_SECRET) return null;
  return /^\d{4,20}$/.test(raw) ? null : { dian_pin: true };
};

// ── Validadores de grupo ───────────────────────────────────────────────────

/**
 * El fin del rango tiene que ser mayor que el inicio.
 *
 * Fábrica y no constante porque los formularios no comparten los nombres de sus
 * controles: la plataforma usa `rango_inicial`/`rango_final` y otros usan
 * `range_from`/`range_to`. Un validador de grupo con nombres fijos falla en
 * silencio en cuanto se monta en otro formulario —devuelve `null` porque no
 * encuentra los controles— y eso se lee igual que «rango válido».
 */
export function rangeOrderValidator(
  fromKey: string,
  toKey: string,
): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const from = Number(group.get(fromKey)?.value);
    const to = Number(group.get(toKey)?.value);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return to <= from ? { rango_final_invalid: true } : null;
  };
}

/** Los nombres que usa el formulario de resoluciones de plataforma. */
export const rangoFinalGreaterValidator = rangeOrderValidator(
  'rango_inicial',
  'rango_final',
);

/**
 * Exige marcar la casilla antes de activar producción.
 *
 * OJO: en el riel de plataforma el backend ya rechaza `environment: 'production'`
 * en `PATCH config` —la vía es `POST promote-to-production`, con el reporte de
 * readiness completo—, así que en ese formulario esta validación dejó de ser la
 * guarda y pasó a ser una cortesía. Se conserva porque los otros rieles sí
 * cambian de ambiente desde el formulario.
 */
export const confirmProductionValidator: ValidatorFn = (
  group: AbstractControl,
): ValidationErrors | null => {
  const environment = group.get('environment')?.value;
  const enabled = group.get('is_enabled')?.value;
  const confirmed = group.get('confirm_production')?.value;
  if (environment === 'production' && enabled && !confirmed) {
    return { confirm_production_required: true };
  }
  return null;
};

// ── Mensajes ───────────────────────────────────────────────────────────────

/**
 * Texto por clave de error, para que las cuatro superficies digan LO MISMO.
 *
 * Sin esto cada formulario redacta su propio mensaje y el usuario recibe tres
 * explicaciones distintas del mismo rechazo. Y un mensaje que solo dice «campo
 * inválido» sobre un UUID de la DIAN no le dice a nadie qué corregir.
 */
export const DIAN_VALIDATION_MESSAGES: Record<string, string> = {
  required: 'Este dato es obligatorio.',
  dian_uuid:
    'La DIAN emite este identificador como UUID (8-4-4-4-12). Cópialo del correo de habilitación, sin espacios.',
  nit_format:
    'El NIT va sin puntos ni comas: entre 5 y 15 dígitos, y el dígito de verificación opcional tras un guion.',
  // `nitDv` en camelCase: es la clave que emite `nitDvValidator` de `nit.util.ts`,
  // y ese validador es de GRUPO, así que este mensaje lo pinta el formulario, no
  // `app-input`. Se deja también `nit_dv` por si algún control lo emite suelto.
  nitDv:
    'El dígito de verificación no corresponde a este NIT. Entra en el cálculo del CUFE, así que un dígito equivocado hace que la DIAN rechace cada documento.',
  nit_dv: 'El dígito de verificación no corresponde a este NIT.',
  dian_pin:
    'El PIN del software es numérico, entre 4 y 20 dígitos. Entra en el cálculo del CUDE, así que un dígito de más invalida el documento.',
  numeric_id: 'Debe ser un número entero positivo.',
  rango_final_invalid: 'El número final del rango debe ser mayor que el inicial.',
  confirm_production_required:
    'Confirma que entiendes que se emitirá ante la DIAN en producción.',
};

/** Primer mensaje aplicable de un control, o `null` si está válido. */
export function dianValidationMessage(
  control: AbstractControl | null | undefined,
): string | null {
  if (!control || !control.errors) return null;
  for (const key of Object.keys(control.errors)) {
    const message = DIAN_VALIDATION_MESSAGES[key];
    if (message) return message;
  }
  return 'Revisa este dato.';
}
