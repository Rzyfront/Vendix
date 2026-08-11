/**
 * ESPEJO FRONTEND del agregado de estado fiscal por habilitación.
 *
 * Archivos espejados:
 * - `apps/backend/src/domains/store/invoicing/dian-config/dto/fiscal-readiness.dto.ts`
 * - `apps/backend/src/domains/store/invoicing/providers/fiscal-production-readiness.service.ts`
 *   (`ProductionReadinessCheck`, `ProductionReadinessReport`, `isBlockingCheck`,
 *   `isActionableCheck`, `CERTIFICATE_EXPIRY_ALERT_DAYS`).
 *
 * Lo consume `GET {rail}/dian-config/fiscal-readiness`, donde `{rail}` es
 * `store/invoicing` en el panel del comerciante y
 * `superadmin/tenants/{scope}/{id}/invoicing` en la consola. El mismo tipo sirve
 * a las dos porque el backend responde lo mismo por los dos railes: si aquí
 * hubiera un tipo por consola, cada una acabaría interpretando el checklist a su
 * manera y una de las dos mentiría.
 */

import type {
  DianConfigurationType,
  FiscalDocumentType,
} from './fiscal-document-requirements';

/**
 * Un prerrequisito incumplido, redactado para el comerciante (no para un log).
 */
export interface ProductionReadinessCheck {
  key: string;
  label: string;
  satisfied: boolean;
  /** Qué tiene que hacer al respecto. Vacío cuando ya está satisfecho. */
  action: string;
  /**
   * `tenant` = lo puede arreglar el comerciante desde el panel.
   * `platform` = sólo operaciones de Vendix puede (p. ej. una variable de
   * entorno que falta).
   */
  owner: 'tenant' | 'platform';
  /**
   * `blocking` (el valor por defecto cuando falta) mantiene el significado
   * histórico: un check incumplido deja la configuración NO lista.
   *
   * `warning` es una alerta temprana — algo que hoy funciona pero dejará de
   * funcionar en una fecha conocida (un certificado por vencer, un rango de
   * numeración por agotarse). **NUNCA debe volver `ready` false ni bloquear un
   * botón**: un aviso que bloquea la emisión en el momento en que salta no es un
   * aviso, es la caída que venía a prevenir.
   */
  severity?: 'blocking' | 'warning';
  /**
   * A QUIÉN se está esperando — ortogonal a `owner`, que dice quién puede
   * arreglarlo.
   *
   * `vendix` = la pelota está de nuestro lado de la red. Accionable ahora.
   * `dian` = ya hicimos nuestra parte y la DIAN no ha fallado. NO accionable:
   * pintar copy tipo «sube el certificado» para estos es lo que hace que un
   * comerciante reenvíe un set de pruebas que sigue en revisión y queme un
   * segundo bloque de consecutivos.
   *
   * Por defecto `vendix` cuando falta.
   */
  blocked_by?: 'vendix' | 'dian';
  /** Días que quedan, en los avisos por tiempo. */
  days_remaining?: number;
  /** Porcentaje del rango de numeración todavía disponible. */
  percent_remaining?: number;
}

export interface ProductionReadinessReport {
  ready: boolean;
  dian_configuration_id: number;
  environment: string;
  enablement_status: string;
  checks: ProductionReadinessCheck[];
  missing: string[];
  /**
   * Checks `warning` incumplidos. Separados de `missing` a propósito: la UI los
   * muestra en otro registro («esto se va a romper») y ninguna compuerta de
   * promoción puede leerlos como bloqueantes.
   */
  warnings: ProductionReadinessCheck[];
  /** Checks bloqueantes sobre los que el comerciante o Vendix todavía puede actuar. */
  actionable: ProductionReadinessCheck[];
  /**
   * Checks bloqueantes donde nuestra parte está hecha y la DIAN no ha fallado.
   * Van aparte para que la UI diga «esperando a la DIAN» en vez de entregar una
   * tarea que nadie puede completar.
   */
  waiting_on_dian: ProductionReadinessCheck[];
}

/** Un check cuenta contra `ready` sólo cuando es bloqueante. */
export function isBlockingCheck(check: ProductionReadinessCheck): boolean {
  return (check.severity ?? 'blocking') === 'blocking';
}

/** `true` cuando todavía se puede actuar sobre el check. */
export function isActionableCheck(check: ProductionReadinessCheck): boolean {
  return (check.blocked_by ?? 'vendix') === 'vendix';
}

/**
 * Escalera de alerta del vencimiento del certificado, en días. Espejo de
 * `CERTIFICATE_EXPIRY_ALERT_DAYS`. Los tramos son los que una renovación
 * colombiana necesita de verdad: reexpedir un `.p12` ante una entidad de
 * certificación digital toma días, no minutos.
 */
export const CERTIFICATE_EXPIRY_ALERT_DAYS = [30, 15, 7] as const;

/** Por debajo de esta fracción de números restantes se marca la resolución. */
export const RESOLUTION_RANGE_WARNING_PERCENT = 10;

/**
 * Una resolución de numeración, SIN la clave técnica.
 *
 * La ClTec alimenta el CUFE de cada documento electrónico: quien la tiene puede
 * reconstruir la huella fiscal del comerciante. Por eso el agregado reporta
 * ÚNICAMENTE su presencia. **La UI no tiene de dónde sacar el valor y no debe
 * fingir que sí**: en edición el campo va vacío con placeholder «sin cambios».
 */
export interface FiscalReadinessResolution {
  id: number;
  /**
   * Qué documento numera esta fila. Un eje agrupa varios documentos (la
   * habilitación `invoicing` cubre factura, nota crédito y nota débito), así que
   * sin este campo dos filas del mismo eje serían indistinguibles.
   */
  document_type: FiscalDocumentType;
  prefix: string | null;
  range_from: number;
  range_to: number;
  current_number: number;
  /** El backend serializa `Date`; por HTTP llega como ISO string. */
  valid_from: string;
  valid_to: string;
  is_active: boolean;
  /** ¿Hay ClTec guardada? El valor NUNCA viaja. */
  technical_key_set: boolean;
  /** Rótulo del acto administrativo, cuando el eje lo tiene. */
  resolution_number?: string | null;
  resolution_date?: string | null;
}

/**
 * El estado de UNA de las cuatro habilitaciones DIAN.
 *
 * Siempre presente, tenga configuración o no: un eje que no aparece se lee como
 * «no aplica a este comerciante», que es justo la lectura equivocada que hace
 * invisible al documento soporte.
 */
export interface FiscalReadinessAxis {
  configuration_type: DianConfigurationType;
  /** Rótulo en español, derivado del contrato — no escrito a mano por consola. */
  label: string;
  /** `null` cuando el eje todavía no tiene configuración. */
  config_id: number | null;
  /** Ambiente REAL de la configuración; `null` cuando no hay ninguna. */
  environment: string | null;
  /** Estado REAL de la habilitación. `'not_started'` cuando no hay configuración. */
  enablement_status: string;
  /** El checklist completo. `null` cuando no hay configuración que evaluar. */
  readiness: ProductionReadinessReport | null;
  /** Resoluciones de TODOS los documentos del eje, activas e inactivas. */
  resolutions: FiscalReadinessResolution[];
}

/** Respuesta completa del agregado: los cuatro ejes, siempre. */
export interface FiscalReadinessResponse {
  /**
   * Quién es el dueño fiscal: `'ORGANIZATION'` significa que la configuración se
   * administra a nivel organización y que el alta desde la tienda está
   * bloqueada. La UI lo necesita para no ofrecer un botón que el backend va a
   * rechazar.
   */
  fiscal_scope: string;
  axes: FiscalReadinessAxis[];
}

/** Estados de habilitación DIAN. Espejo de `dian_enablement_status_enum`. */
export type DianEnablementStatus =
  | 'not_started'
  | 'testing'
  | 'test_set_passed'
  | 'enabled'
  | 'suspended'
  | 'expired';

export const DIAN_ENABLEMENT_STATUS_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    not_started: 'Sin configurar',
    testing: 'En habilitación',
    test_set_passed: 'Set de pruebas aprobado',
    enabled: 'Habilitado',
    suspended: 'Suspendido',
    expired: 'Vencido',
  });

export const DIAN_ENVIRONMENT_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    test: 'Pruebas',
    production: 'Producción',
  });

/**
 * Estado del certificado digital de una configuración DIAN.
 *
 * Laxa a propósito: las dos superficies leen la misma fila
 * `dian_configurations` pero la sirven con envoltorios distintos, y un tipo
 * estricto obligaría a un adaptador por consola para no ganar nada. Un campo
 * ausente simplemente no se rinde.
 */
export interface DianCertificateState {
  /** NIT declarado en la configuración, para contrastarlo con el del `.p12`. */
  nit?: string | null;
  certificate_expiry?: string | null;
  certificate_fingerprint?: string | null;
  certificate_subject?: string | null;
  certificate_issuer?: string | null;
  certificate_serial_number?: string | null;
  /** NIT leído del propio certificado. Si no coincide, la DIAN rechaza la firma. */
  certificate_nit?: string | null;
  certificate_source?: string | null;
  certificate_uploaded_at?: string | null;
  /**
   * ARN de la llave KMS que custodia la privada. Cuando está presente, la firma
   * la produce KMS y el `.p12` nunca se abre en memoria del proceso.
   */
  certificate_kms_key_id?: string | null;
  /** Presencia del `.p12` en S3. Algunas superficies sólo exponen esto. */
  certificate_s3_key?: string | null;
}
