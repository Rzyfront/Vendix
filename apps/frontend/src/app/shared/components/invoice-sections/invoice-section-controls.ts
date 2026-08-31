import { AbstractControl, FormGroup } from '@angular/forms';

/**
 * Cómo un componente de sección compartido llega a los controles cuando las dos
 * pantallas los tienen con otro nombre y en otro sitio.
 *
 * ## El problema
 *
 * «Nueva factura» tiene el formulario PLANO: `use_foreign_currency`,
 * `foreign_currency`. El editor de perfiles lo tiene ANIDADO y con otros
 * nombres: `currency.declare_foreign`, `currency.code`. Renombrar cualquiera de
 * los dos lados es un cambio de contrato con el backend —y del lado del perfil,
 * además, rompería la lectura de snapshots ya persistidos, que son inmutables
 * a propósito—.
 *
 * ## La solución
 *
 * El componente no usa `formControlName`. Recibe el `FormGroup` y un mapa de
 * RUTAS por nombre canónico, y enlaza con `[formControl]`. Así el mismo
 * marcado sirve para las dos pantallas sin tocar ni un DTO.
 *
 * ## Por qué un control que falta LANZA en vez de ignorarse
 *
 * Si `group.get(ruta)` devuelve `null` y el componente se limita a no pintar el
 * campo, el resultado es un campo fiscal que desaparece de la pantalla y viaja
 * ausente al backend, sin ningún error. En una factura eso es un documento
 * emitido sin un dato que debía llevar. Un `Error` en desarrollo, con el nombre
 * de la ruta y de la sección, es infinitamente más barato.
 */
export function requireControl(
  group: FormGroup,
  path: string,
  section: string,
): AbstractControl {
  const control = group.get(path);
  if (!control) {
    throw new Error(
      `[${section}] El formulario no tiene el control «${path}». ` +
        `Revisa el mapa de nombres de la sección: un control ausente no se ` +
        `pinta, viaja ausente al backend y no produce ningún error visible.`,
    );
  }
  return control;
}

/**
 * El control si existe, `null` si no. Sólo para campos DECLARADOS opcionales en
 * el mapa de nombres —los que una de las dos pantallas legítimamente no tiene,
 * como la tasa de cambio en un perfil—.
 */
export function optionalControl(
  group: FormGroup,
  path: string | null | undefined,
): AbstractControl | null {
  if (!path) return null;
  return group.get(path);
}
