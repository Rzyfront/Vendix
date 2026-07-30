import { ErrorCodeEntry, ErrorCodes } from '@common/errors';
import type { OpenSessionsSummary } from '../../cash-registers/sessions/sessions.service';

/**
 * QUI-560 — precondiciones de TRANSICIÓN para `store_settings`.
 *
 * `SettingsService.sanitizeAndValidate()` valida la *forma* del payload: que las
 * claves existan y que los tipos cuadren. Lo que no existía era ningún predicado
 * sobre el *cambio* de un valor — apagar `pos.cash_register.enabled` con
 * sesiones de caja abiertas devolvía 200 y dejaba la sesión viva registrando
 * nada, porque cuatro servicios (`payments`, `refund-flow`, `order-flow`,
 * `table-sessions`) omiten la escritura en `cash_register_movements` cuando el
 * flag está apagado.
 *
 * Este archivo declara esas precondiciones como DATO, no como ramas de código.
 * Consecuencias buscadas:
 *
 *  - Los tres caminos de escritura (`updateSettings`, `resetToDefault`,
 *    `applyTemplate`) pasan por la misma puerta; no hay puertas traseras.
 *  - Agregar una precondición futura (cola de clientes con tickets vivos, mesas
 *    con cuenta abierta, período de nómina en curso) es una entrada nueva en el
 *    arreglo, no un `if` nuevo en el servicio.
 *  - Un toggle destructivo que llegue sin entrada aquí es visible en code
 *    review, porque el lugar donde debería estar es un archivo único y corto.
 */

/**
 * Dependencias que un guard puede consultar. Se inyectan como funciones para
 * que el registro no dependa de Nest ni de Prisma y sea trivial de testear.
 */
export interface SettingsTransitionGuardDeps {
  /** Sesiones de caja abiertas en la tienda en contexto (todas, no solo las del usuario). */
  countOpenCashSessions: () => Promise<OpenSessionsSummary>;
}

export interface SettingsTransitionGuardResult {
  blocked: boolean;
  /** Mensaje accionable para el usuario final. Solo se usa si `blocked`. */
  detail?: string;
  /** Metadata pública adjuntada al error (`details`). Nunca datos sensibles. */
  metadata?: Record<string, unknown>;
}

export interface SettingsTransitionGuard {
  /** Ruta con puntos dentro del objeto de settings, ej. `pos.cash_register.enabled`. */
  path: string;
  /** Valor de origen que activa el guard. */
  from: unknown;
  /** Valor de destino que activa el guard. */
  to: unknown;
  /** Código de error lanzado cuando `check` bloquea. */
  errorCode: ErrorCodeEntry;
  check: (
    deps: SettingsTransitionGuardDeps,
  ) => Promise<SettingsTransitionGuardResult>;
}

/**
 * Lee una ruta con puntos de forma tolerante: cualquier tramo ausente devuelve
 * `undefined` en vez de lanzar. Necesario porque `resetToDefault` y
 * `applyTemplate` comparan contra objetos que pueden no traer la sección.
 */
export function readSettingsPath(
  settings: unknown,
  path: string,
): unknown {
  let cursor: any = settings;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/**
 * Formatea la lista de cajas para el mensaje al usuario.
 * `['Caja Principal', 'Caja 2']` -> `"Caja Principal" y "Caja 2"`.
 */
function formatRegisterNames(registers: { name: string }[]): string {
  const quoted = registers.map((r) => `"${r.name}"`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} y ${quoted[quoted.length - 1]}`;
}

export const SETTINGS_TRANSITION_GUARDS: SettingsTransitionGuard[] = [
  {
    // Apagar la caja registradora teniendo sesiones abiertas deja esas sesiones
    // vivas pero ciegas: dejan de recibir los movimientos de venta y devolución
    // mientras el recaudo de planilla DSD sigue escribiendo en ellas. El
    // resultado es un libro incompleto imposible de cuadrar y una caja que ya no
    // se puede reabrir. Se bloquea la transición; NO se cierran las sesiones
    // automáticamente, porque inventar el conteo de cierre y la diferencia
    // sobrante/faltante sería destruir datos de negocio en silencio.
    path: 'pos.cash_register.enabled',
    from: true,
    to: false,
    errorCode: ErrorCodes.CASH_REGISTER_DISABLE_001,
    check: async (deps) => {
      const { count, registers } = await deps.countOpenCashSessions();
      if (count === 0) return { blocked: false };

      const plural = count === 1 ? 'sesión abierta' : 'sesiones abiertas';
      const names = formatRegisterNames(registers);

      return {
        blocked: true,
        detail:
          `No se puede deshabilitar la caja registradora: la tienda tiene ` +
          `${count} ${plural}${names ? ` en ${names}` : ''}. ` +
          `Ciérralas desde Caja Registradora antes de continuar.`,
        metadata: { open_sessions: count, registers },
      };
    },
  },
];
