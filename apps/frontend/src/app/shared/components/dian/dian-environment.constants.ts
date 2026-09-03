/**
 * Ambientes DIAN como opciones de selector, para los componentes COMPARTIDOS.
 *
 * ## Por qué existe este archivo
 *
 * Las mismas opciones ya existían en
 * `private/modules/super-admin/fiscal/invoicing/platform-invoicing.constants.ts`
 * (`ENVIRONMENT_OPTIONS`), pero eso es un módulo de super admin: un componente
 * de `shared/` que importara de ahí ataría la consola del comerciante a la
 * consola interna y arrastraría todo ese módulo a su grafo de dependencias.
 * Aquí viven declaradas del lado compartido, que es el único lado que las dos
 * consolas pueden usar.
 *
 * ## Por qué las etiquetas NO se escriben aquí
 *
 * Se derivan de `DIAN_ENVIRONMENT_LABELS` (`fiscal-readiness.interface.ts`),
 * que ya es el diccionario de cómo se nombra cada ambiente en toda la
 * interfaz. Un segundo diccionario acabaría diciendo «Sandbox» donde el resto
 * dice «Pruebas», y en una pantalla cuyo error caro es confundir habilitación
 * con producción, dos nombres para el mismo ambiente es exactamente el fallo
 * que hay que evitar.
 */

import type { DianEnvironment } from '../../services/dian/dian-config-api.service';
import type { SelectorOption } from '../selector/selector.component';
import { DIAN_ENVIRONMENT_LABELS } from './fiscal-readiness.interface';

/**
 * Los dos ambientes, en el orden en que se ofrecen: pruebas primero porque es
 * donde empieza toda habilitación, producción después.
 */
export const DIAN_ENVIRONMENTS = [
  'test',
  'production',
] as const satisfies readonly DianEnvironment[];

/** `true` sólo para los dos literales del contrato. Todo lo demás se descarta. */
export function isDianEnvironment(value: unknown): value is DianEnvironment {
  return value === 'test' || value === 'production';
}

/**
 * Cómo se lee un ambiente en pantalla. Devuelve `null` —y no un texto
 * inventado— cuando no hay ambiente: un rótulo por defecto haría creer que se
 * consultó algo cuando todavía no se ha consultado nada.
 */
export function dianEnvironmentLabel(
  environment: string | null | undefined,
): string | null {
  if (!environment) return null;
  return DIAN_ENVIRONMENT_LABELS[environment] ?? environment;
}

/**
 * Opciones para `app-selector`, derivadas de la lista y del diccionario. Tipo
 * mutable porque el `input()` del selector declara `SelectorOption[]` y un
 * `readonly` no le encaja bajo `strictTemplates`.
 */
export const DIAN_ENVIRONMENT_OPTIONS: SelectorOption[] = DIAN_ENVIRONMENTS.map(
  (value) => ({ value, label: DIAN_ENVIRONMENT_LABELS[value] }),
);
