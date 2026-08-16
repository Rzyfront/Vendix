import { parseApiError } from '../../../../core/utils/parse-api-error';
import {
  ERROR_MESSAGES,
  DEFAULT_ERROR_MESSAGE,
} from '../../../../core/utils/error-messages';
import {
  FISCAL_STEP_LABELS,
  FISCAL_STEP_ORDER,
  FiscalArea,
  FiscalWizardStepId,
} from '../../../../core/models/fiscal-status.model';
import {
  SaveRequirement,
  SaveRequirementSeverity,
} from '../../save-requirements-modal/save-requirements.interface';

/**
 * Espejo frontend del item de checklist fiscal que produce el backend
 * (contrato congelado). El wizard define su propio modelo para no depender de
 * la forma cruda del backend y poder pintar el modal de requisitos.
 *
 * `action.navigate` es el destino: id de paso del wizard (p.ej. `puc`,
 * `dian_config`) o una ruta (`/admin/fiscal`).
 */
export interface FiscalConfigChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  detail: string;
  link_hint?: string;
  severity: SaveRequirementSeverity; // 'blocker' | 'required'
  action?: { label: string; navigate: string };
}

/**
 * Convierte un checklist fiscal del backend en filas del modal de requisitos.
 * Solo emite filas para los items NO completos. El CTA (si el backend lo trae)
 * se traduce a una accion `navigate` cuyo `target` es `action.navigate`.
 */
export function checklistToRequirements(
  items: FiscalConfigChecklistItem[] | null | undefined,
): SaveRequirement[] {
  return (items ?? [])
    .filter((item) => item && item.complete === false)
    .map((item) => ({
      id: item.key,
      label: item.label,
      reason: item.detail,
      severity: item.severity,
      action: item.action
        ? {
            label: item.action.label,
            kind: 'navigate' as const,
            target: item.action.navigate,
          }
        : undefined,
    }));
}

/**
 * Restriccion fiscal curada: precondicion humana + CTA. `area` indica el area
 * fiscal afectada (o `general`). `severity` es opcional; por defecto `blocker`
 * (una restriccion operativa que impide continuar).
 */
export interface FiscalRestriction {
  /** Titulo humano de la restriccion. */
  label: string;
  /** Motivo + que hacer (CTA en prosa). */
  reason: string;
  /** Area fiscal afectada (o `general`). */
  area: FiscalArea | 'general';
  /** Severidad para el modal. Por defecto `blocker` si se omite. */
  severity?: SaveRequirementSeverity;
  /** CTA opcional de navegacion: label + destino (id de paso o ruta). */
  action?: { label: string; navigate: string };
}

/**
 * MAPEO COMPLETO DE RESTRICCIONES FISCALES (config + operativo).
 *
 * Catalogo curado `error_code -> restriccion`. Cada entrada documenta la
 * precondicion (por que aparece) y la CTA (que hacer). Es la fuente unica que
 * traduce cualquier 4xx fiscal a un mensaje accionable en el modal.
 *
 * Destinos de navegacion:
 *  - id de paso del wizard cuando la solucion vive en un paso concreto.
 *  - `/admin/fiscal` cuando la solucion es volver al hub fiscal.
 */
export const FISCAL_RESTRICTION_MAP: Record<string, FiscalRestriction> = {
  // ── Estado / activacion ────────────────────────────────────
  // Precondicion: se intento activar un area con pasos requeridos sin datos
  // reales guardados. CTA: completar los pasos pendientes en Validacion.
  FISCAL_STATUS_INCOMPLETE: {
    label: 'Faltan pasos por completar',
    reason:
      'No se puede activar el manejo fiscal: hay pasos requeridos sin datos guardados. Completa cada paso pendiente antes de activar.',
    area: 'general',
    severity: 'required',
    action: { label: 'Volver a Validación', navigate: 'validation' },
  },
  // Precondicion: la configuracion fiscal de la entidad esta incompleta (falta
  // algun dato base). CTA: terminar el wizard de configuracion fiscal.
  FISCAL_CONFIG_INCOMPLETE: {
    label: 'Configuración fiscal incompleta',
    reason:
      'La configuración fiscal de esta entidad está incompleta. Termina el asistente de manejo fiscal para poder operar.',
    area: 'general',
    severity: 'required',
    action: { label: 'Ir al manejo fiscal', navigate: '/admin/fiscal' },
  },
  // Precondicion: existen documentos fiscales emitidos que congelan la config.
  // CTA: informativo, ya no es modificable.
  FISCAL_STATUS_LOCKED: {
    label: 'Manejo fiscal bloqueado',
    reason:
      'El manejo fiscal está bloqueado porque ya existen documentos fiscales emitidos. Esta configuración ya no se puede modificar.',
    area: 'general',
  },
  // Precondicion: transicion de estado fiscal no permitida desde el actual.
  // CTA: refrescar y reintentar (posible estado desincronizado en el cliente).
  FISCAL_STATUS_INVALID_TRANSITION: {
    label: 'Transición fiscal no válida',
    reason:
      'No se puede cambiar el estado fiscal desde el estado actual. Refresca la página y vuelve a intentarlo.',
    area: 'general',
    severity: 'required',
  },
  // Precondicion: la operacion no corresponde a la entidad fiscal en contexto.
  // CTA: revisar tienda/entidad seleccionada.
  FISCAL_SCOPE_INVALID: {
    label: 'Entidad fiscal incorrecta',
    reason:
      'La operación no corresponde a la entidad fiscal actual. Revisa la tienda o la entidad seleccionada.',
    area: 'general',
  },
  // Precondicion: falta el NIT de la entidad fiscal. CTA: registrarlo en datos
  // legales.
  FISCAL_SCOPE_MISSING_TAX_ID: {
    label: 'Falta el NIT de la entidad',
    reason:
      'Falta el NIT de la entidad fiscal. Regístralo en los datos legales antes de continuar.',
    area: 'general',
    severity: 'required',
    action: { label: 'Volver a Datos legales', navigate: 'legal_data' },
  },
  // Precondicion: un reintento fiscal no coincide con el envio original.
  // CTA: no reintentar a ciegas; revisar el envio original.
  FISCAL_IDEMPOTENCY_CONFLICT: {
    label: 'Reintento fiscal inconsistente',
    reason:
      'El reintento no coincide con el envío fiscal original. No reintentes con datos distintos; revisa el documento original.',
    area: 'general',
  },

  // ── Contabilidad / periodo / PUC / impuestos ───────────────
  // Precondicion: la contabilidad fiscal esta bloqueada hasta aceptacion DIAN.
  // CTA: esperar/validar la aceptacion DIAN del documento.
  FISCAL_ACCOUNTING_BLOCKED: {
    label: 'Contabilidad fiscal bloqueada',
    reason:
      'La contabilidad fiscal está bloqueada hasta que exista aceptación DIAN del documento. Valida la aceptación antes de contabilizar.',
    area: 'accounting',
  },
  // Precondicion: el periodo fiscal de la fecha esta cerrado. CTA: reabrir el
  // periodo o registrar en un periodo abierto.
  FISCAL_PERIOD_CLOSED: {
    label: 'Periodo fiscal cerrado',
    reason:
      'El periodo fiscal de esa fecha está cerrado y no admite movimientos. Reabre el periodo o usa una fecha dentro de un periodo abierto.',
    area: 'accounting',
    action: { label: 'Volver a Periodo fiscal', navigate: 'accounting_period' },
  },
  // Precondicion: aun no existe plan de cuentas (PUC). CTA: crearlo en el paso
  // de PUC.
  CHART_NOT_SEEDED: {
    label: 'Falta el plan de cuentas (PUC)',
    reason:
      'Aún no existe un plan de cuentas (PUC). Créalo en el paso de PUC antes de continuar.',
    area: 'accounting',
    severity: 'required',
    action: { label: 'Ir a PUC', navigate: 'puc' },
  },
  // Precondicion: el PUC ya fue sembrado. CTA: no re-sembrar, editar cuentas.
  CHART_ALREADY_SEEDED: {
    label: 'El PUC ya fue creado',
    reason:
      'El plan de cuentas (PUC) ya fue creado para esta entidad fiscal. No lo vuelvas a sembrar; edita las cuentas existentes.',
    area: 'accounting',
    severity: 'required',
    action: { label: 'Ir a PUC', navigate: 'puc' },
  },
  // Precondicion: los impuestos por defecto ya fueron sembrados. CTA: editar.
  TAXES_ALREADY_SEEDED: {
    label: 'Los impuestos ya fueron creados',
    reason:
      'Los impuestos por defecto ya fueron creados para esta entidad fiscal. No los vuelvas a sembrar; edita los existentes.',
    area: 'accounting',
    severity: 'required',
    action: { label: 'Ir a Impuestos', navigate: 'default_taxes' },
  },
  // Precondicion: falta la entidad contable (identidad fiscal) de la tienda.
  // CTA: completar datos legales antes de sembrar el PUC.
  MISSING_ACCOUNTING_ENTITY: {
    label: 'Falta la entidad fiscal',
    reason:
      'Falta la entidad fiscal de la tienda. Completa los datos legales (NIT y razón social) antes de crear el plan de cuentas.',
    area: 'accounting',
    severity: 'required',
    action: { label: 'Volver a Datos legales', navigate: 'legal_data' },
  },

  // ── Facturacion / resoluciones / documento ─────────────────
  // Precondicion: no hay resolucion DIAN activa. CTA: registrar resolucion.
  FISCAL_RESOLUTION_MISSING: {
    label: 'Falta la resolución DIAN',
    reason:
      'No hay una resolución DIAN activa para esta entidad fiscal. Registra la resolución de facturación.',
    area: 'invoicing',
    severity: 'required',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: la numeracion de la resolucion esta agotada. CTA: crear una
  // nueva resolucion.
  FISCAL_RESOLUTION_EXHAUSTED: {
    label: 'Numeración DIAN agotada',
    reason:
      'La numeración DIAN de esta resolución está agotada. Crea una nueva resolución para seguir facturando.',
    area: 'invoicing',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: tipo de documento no implementado en software propio DIAN.
  // CTA: usar otro tipo o contactar soporte.
  FISCAL_DOCUMENT_UNSUPPORTED: {
    label: 'Documento no soportado',
    reason:
      'Este tipo de documento fiscal aún no está implementado para DIAN con software propio. Usa otro tipo de documento o contacta a soporte.',
    area: 'invoicing',
  },

  // ── Facturacion: preconditions de CONFIGURACION ────────────
  //
  // QUE ENTRA EN ESTE MAPA (y por que no entran los demas codigos INVOICING_*).
  // Estar aqui significa que `presentFiscalError` SECUESTRA el error: en lugar
  // de un toast, se abre el modal de requisitos con un texto fijo y un CTA. Eso
  // solo es correcto cuando el fallo cumple las tres condiciones:
  //
  //   (a) es una PRECONDICION que vive en la configuracion, no en el documento;
  //   (b) tiene un destino concreto adonde mandar al usuario a arreglarlo;
  //   (c) no trae detalle por-instancia que una fila fija destruiria.
  //
  // Por (c) quedan FUERA `INVOICING_PROVIDER_004` —trae en `details.dian_errors`
  // las reglas que la DIAN nombro, y una fila estatica las borraria justo cuando
  // son lo unico accionable— e `INVOICING_CUFE_001`, que es un fallo interno de
  // coherencia: no hay nada que el comerciante pueda ir a configurar.
  //
  // Por (a) quedan fuera `INVOICING_STATUS_*`, `INVOICING_DUP_001`,
  // `INVOICING_FIND_*` y `INVOICING_VALIDATE_001` (estado del documento), y por
  // (b) los `INVOICING_RESOLUTION_003..005` y `007..011`, que se levantan
  // MIENTRAS el usuario edita la resolucion: mandarlo "a DIAN" cuando ya esta
  // parado en DIAN es ruido; esos van al campo del formulario.
  //
  // `INVOICING_RESOLUTION_001/002` tampoco entran: no los lanza nadie en el
  // backend — la numeracion falla con `FISCAL_RESOLUTION_MISSING` /
  // `FISCAL_RESOLUTION_EXHAUSTED`, que ya estan arriba.
  //
  // Con el mismo criterio quedan FUERA tres codigos mas, que van por toast:
  //  - `INVOICING_XSD_001`: fallo de coherencia interna del generador de XML.
  //    Falla (a) y (b) — no hay dato del comerciante que lo cause ni pantalla
  //    donde arreglarlo; el copy explica que no se gasto numeracion.
  //  - `DIAN_EVENT_005`: el backend nombra en `details` el campo que falta del
  //    evento RADIAN, y ese campo cambia por codigo de evento. Falla (c).
  //  - `DIAN_TEST_SET_007`: el lote consultado no existe, expiro o es de otra
  //    config. Falla (b): no hay nada que configurar, solo volver a consultar.

  // Precondicion: la tienda no tiene habilitada la configuracion DIAN de
  // software propio con la que se transmite. 412 = precondicion de config.
  // CTA: completarla en Facturacion -> Configuracion DIAN.
  INVOICING_PROVIDER_002: {
    label: 'Falta la configuración DIAN de la tienda',
    reason:
      'El proveedor de facturación electrónica no está configurado para esta tienda. Complétalo en Facturación → Configuración DIAN antes de transmitir.',
    area: 'invoicing',
    severity: 'required',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: la habilitacion de produccion esta incompleta — tipicamente
  // la resolucion sin clave tecnica (ClTec), sin la cual el CUFE se firmaria
  // mal y la DIAN rechazaria el documento gastando el consecutivo.
  // CTA: completar la config DIAN / la resolucion de numeracion.
  INVOICING_PROVIDER_003: {
    label: 'Habilitación DIAN incompleta',
    reason:
      'Faltan datos obligatorios para transmitir a la DIAN (normalmente la clave técnica de la resolución de numeración). Revisa la configuración DIAN y la resolución antes de reintentar.',
    area: 'invoicing',
    severity: 'required',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: la identidad fiscal no tiene entidad contable activa y una
  // resolucion no puede colgar de la nada. Gemelo de MISSING_ACCOUNTING_ENTITY.
  // CTA: completar los datos legales.
  INVOICING_RESOLUTION_006: {
    label: 'Falta la entidad contable activa',
    reason:
      'La identidad fiscal no tiene una entidad contable activa, y una resolución tiene que colgar de una. Actívala en los datos legales antes de crear la resolución.',
    area: 'invoicing',
    severity: 'required',
    action: { label: 'Volver a Datos legales', navigate: 'legal_data' },
  },

  // ── Habilitacion / certificado DIAN ────────────────────────
  // Precondicion: falta configurar la conexion DIAN. CTA: configurarla.
  DIAN_CONFIG_001: {
    label: 'Falta configuración DIAN',
    reason:
      'No se encontró la configuración DIAN de esta tienda. Configúrala para poder facturar electrónicamente.',
    area: 'invoicing',
    severity: 'required',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: ya existe una config DIAN. CTA: editar la existente.
  DIAN_CONFIG_002: {
    label: 'La configuración DIAN ya existe',
    reason:
      'Ya existe una configuración DIAN con ese NIT y tipo de documento en este alcance. Edita la existente en lugar de crear otra.',
    area: 'invoicing',
    severity: 'required',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: el archivo de certificado es invalido. CTA: recargar uno valido.
  DIAN_CERT_001: {
    label: 'Certificado inválido',
    reason:
      'El archivo del certificado digital es inválido. Carga un certificado .p12/.pfx válido.',
    area: 'invoicing',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: contrasena del certificado incorrecta. CTA: corregir clave.
  DIAN_CERT_002: {
    label: 'Contraseña del certificado incorrecta',
    reason:
      'La contraseña del certificado digital es incorrecta. Vuelve a cargarlo con la contraseña correcta.',
    area: 'invoicing',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: certificado vencido. CTA: renovar y recargar.
  DIAN_CERT_003: {
    label: 'Certificado vencido',
    reason:
      'El certificado digital está vencido. Renuévalo ante tu proveedor y vuelve a cargarlo.',
    area: 'invoicing',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: el certificado no coincide con el NIT de la entidad. CTA:
  // cargar el certificado del NIT correcto.
  DIAN_CERT_004: {
    label: 'Certificado con NIT distinto',
    reason:
      'El certificado no coincide con el NIT de la entidad fiscal. Carga el certificado emitido para el NIT correcto.',
    area: 'invoicing',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: no se pudo conectar con la DIAN. CTA: reintentar.
  DIAN_CONN_001: {
    label: 'Sin conexión con la DIAN',
    reason:
      'No se pudo conectar con la DIAN. Revisa tu conexión e inténtalo de nuevo en unos minutos.',
    area: 'invoicing',
  },
  // Precondicion: la DIAN rechazo el documento. CTA: revisar el documento.
  DIAN_SEND_001: {
    label: 'La DIAN rechazó el documento',
    reason:
      'La DIAN rechazó el documento. Revisa los datos del documento y vuelve a enviarlo.',
    area: 'invoicing',
  },
  // Precondicion: timeout de la solicitud a la DIAN. CTA: reintentar.
  DIAN_SEND_002: {
    label: 'La DIAN no respondió a tiempo',
    reason:
      'La solicitud a la DIAN agotó el tiempo de espera. Inténtalo de nuevo en unos minutos.',
    area: 'invoicing',
  },
  // Precondicion: faltan requisitos para habilitar DIAN en produccion. CTA:
  // completar la habilitacion (set de pruebas, certificado, resolucion).
  DIAN_ENABLEMENT_001: {
    label: 'Habilitación DIAN incompleta',
    reason:
      'Faltan requisitos para habilitar la DIAN en producción (set de pruebas, certificado o resolución). Completa la habilitación.',
    area: 'invoicing',
    severity: 'required',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: la config DIAN no esta en modo software propio, que es el
  // unico modo en el que Vendix firma y transmite. 412 = precondicion de config.
  // CTA: cambiar el modo de operacion en la config DIAN.
  DIAN_PROVIDER_OWN_SOFTWARE_REQUIRED: {
    label: 'Falta el modo software propio',
    reason:
      'Para emitir en producción, la configuración DIAN de esta tienda debe estar en modo "software propio". Cámbialo en la configuración DIAN antes de pasar a producción.',
    area: 'invoicing',
    severity: 'required',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },
  // Precondicion: dos resoluciones activas declaran el MISMO numero y rango, asi
  // que cual numera depende del orden de las filas. Cada gemela avanza su
  // consecutivo por separado: la que quede atras repetira numeros ya entregados
  // a la DIAN, y un consecutivo duplicado se rechaza de forma permanente.
  // CTA: desactivar la duplicada antes de emitir.
  DIAN_TEST_SET_008: {
    label: 'Resolución activa duplicada',
    reason:
      'Hay dos resoluciones activas con el mismo número y rango, y no se puede saber cuál numera. Desactiva la duplicada antes de emitir: si ambas siguen activas, la que quede atrás repetirá consecutivos ya enviados y la DIAN rechazará todo lo que emita con ellos.',
    area: 'invoicing',
    severity: 'required',
    action: { label: 'Volver a DIAN', navigate: 'dian_config' },
  },

  // ── Contexto ───────────────────────────────────────────────
  // Precondicion: no se detecto la tienda activa. CTA: recargar la pagina.
  STORE_CONTEXT_001: {
    label: 'Falta el contexto de tienda',
    reason:
      'No se detectó la tienda activa. Recarga la página e inténtalo de nuevo.',
    area: 'general',
  },
};

/** Opciones para enriquecer las filas construidas desde un error fiscal. */
export interface FiscalRequirementBuildOptions {
  /** Resuelve el label humano de un paso (por defecto FISCAL_STEP_LABELS). */
  stepLabel?: (step: FiscalWizardStepId) => string;
  /** Resuelve un motivo especifico para un paso faltante (p.ej. reasonFor). */
  reasonFor?: (step: FiscalWizardStepId) => string;
  /**
   * Pasos faltantes ya conocidos (p.ej. service.finalizeMissingSteps() o los
   * pendientes del pre-submit). Si se pasan y no estan vacios, se usan como
   * fuente en lugar de leer `err.details.missing_steps`.
   */
  missingSteps?: Partial<Record<FiscalArea, FiscalWizardStepId[]>>;
}

/**
 * Traduce CUALQUIER 4xx fiscal a filas del modal de requisitos.
 *
 * - `FISCAL_STATUS_INCOMPLETE` (o `missingSteps` provisto): UNA fila por paso
 *   faltante, con CTA "Volver a {paso}" (`kind: 'navigate'`, target = id paso).
 * - Codigo presente en {@link FISCAL_RESTRICTION_MAP}: la fila curada.
 * - Codigo desconocido / error plano: fila de fallback con el mensaje UX o el
 *   mensaje del backend.
 *
 * NUNCA devuelve un arreglo vacio: siempre entrega al menos una fila.
 */
export function mapFiscalBackendErrorToRequirements(
  err: unknown,
  options: FiscalRequirementBuildOptions = {},
): SaveRequirement[] {
  const parsed = parseApiError(err);
  const stepLabel =
    options.stepLabel ?? ((step: FiscalWizardStepId) => FISCAL_STEP_LABELS[step] ?? step);

  // 1) Pasos faltantes: por finalize 409 (FISCAL_STATUS_INCOMPLETE con
  //    details.missing_steps) o por missingSteps explicito (pre-submit).
  const explicitMissing = options.missingSteps;
  const hasExplicitMissing = !!explicitMissing && stepCount(explicitMissing) > 0;
  if (hasExplicitMissing || parsed.errorCode === 'FISCAL_STATUS_INCOMPLETE') {
    const missing = hasExplicitMissing
      ? explicitMissing!
      : extractMissingSteps(parsed.details);
    const rows = missingStepsToRequirements(missing, stepLabel, options.reasonFor);
    if (rows.length > 0) {
      return rows;
    }
    // Sin pasos parseables → cae al catalogo/fallback de abajo.
  }

  // 2) Codigo presente en el catalogo curado.
  const restriction = parsed.errorCode
    ? FISCAL_RESTRICTION_MAP[parsed.errorCode]
    : undefined;
  if (parsed.errorCode && restriction) {
    return [
      {
        id: parsed.errorCode,
        label: restriction.label,
        // GANA EL MÁS ESPECÍFICO. `restriction.reason` es texto fijo por código:
        // explica la restricción en general, no ESTA instancia. Cuando el backend
        // devuelve `details.blockers[]` o un `message` accionable, `parseApiError`
        // ya lo resolvió en `userMessage`, y pintar la fila curada encima borraba
        // justo el dato que dice qué campo falta. `label` y CTA sí se conservan:
        // son la clasificación y el destino, que el backend no manda.
        reason: preferBackendDiagnosis(parsed, restriction.reason),
        severity: restriction.severity ?? 'blocker',
        action: restriction.action
          ? {
              label: restriction.action.label,
              kind: 'navigate' as const,
              target: restriction.action.navigate,
            }
          : undefined,
      },
    ];
  }

  // 3) Fallback generico: nunca vacio.
  const fallbackReason = parsed.errorCode
    ? parsed.userMessage
    : (readBackendMessage(err) ??
      'Ocurrio un error al procesar la operacion fiscal. Revisa los datos e intentalo de nuevo.');
  return [
    {
      id: parsed.errorCode ?? 'fiscal-error',
      label: 'No se pudo completar la operación fiscal',
      reason: fallbackReason,
      severity: 'blocker',
    },
  ];
}

/**
 * Decide qué texto explica mejor ESTA falla: el diagnóstico del backend o el
 * motivo curado del catálogo.
 *
 * `parseApiError` ya aplica el orden «gana el más específico» y deja en
 * `userMessage` un bloqueador (`details.blockers[]`) o el `message` del servidor
 * cuando alguno de los dos era presentable; si no había nada mejor, deja el copy
 * enlatado de `ERROR_MESSAGES[code]`. Por eso aquí basta con comparar: si
 * `userMessage` ES el enlatado, el backend no aportó nada y manda el motivo
 * curado —que suele estar mejor redactado para el modal—; si DIFIERE, es porque
 * el servidor calculó el detalle concreto y ése es el que tiene que leerse.
 *
 * Se compara contra `ERROR_MESSAGES[code]` y no contra `DEFAULT_ERROR_MESSAGE`
 * a propósito: un código sin copy enlatado cae al genérico («Ocurrió un error
 * inesperado…»), que tampoco aporta nada y debe ceder ante el motivo curado.
 */
function preferBackendDiagnosis(
  parsed: { errorCode: string | null; userMessage: string },
  curatedReason: string,
): string {
  const canned = parsed.errorCode ? ERROR_MESSAGES[parsed.errorCode] : undefined;
  const backend = parsed.userMessage?.trim();
  if (!backend) {
    return curatedReason;
  }
  // Sin copy enlatado para el código, `userMessage` sólo puede ser el genérico
  // o un diagnóstico real; el genérico se descarta comparándolo aparte.
  if (canned !== undefined && backend === canned.trim()) {
    return curatedReason;
  }
  return backend === DEFAULT_ERROR_MESSAGE.trim() ? curatedReason : backend;
}

/** Cuenta cuantos pasos hay en un mapa area -> pasos. */
function stepCount(
  missing: Partial<Record<FiscalArea, FiscalWizardStepId[]>>,
): number {
  return (Object.keys(missing) as FiscalArea[]).reduce(
    (acc, area) => acc + (missing[area]?.length ?? 0),
    0,
  );
}

/** Extrae de forma segura `details.missing_steps` (Record<area, step[]>). */
function extractMissingSteps(
  details: unknown,
): Partial<Record<FiscalArea, FiscalWizardStepId[]>> {
  if (!details || typeof details !== 'object') {
    return {};
  }
  const missing = (details as { missing_steps?: unknown }).missing_steps;
  return missing && typeof missing === 'object'
    ? (missing as Partial<Record<FiscalArea, FiscalWizardStepId[]>>)
    : {};
}

/**
 * Aplana los pasos faltantes (dedup + orden canonico del wizard) y produce una
 * fila `required` por paso, con CTA "Volver a {paso}" (`navigate`). Excluye los
 * pasos no navegables (`validation`, `area_selection`).
 */
function missingStepsToRequirements(
  missing: Partial<Record<FiscalArea, FiscalWizardStepId[]>>,
  stepLabel: (step: FiscalWizardStepId) => string,
  reasonFor?: (step: FiscalWizardStepId) => string,
): SaveRequirement[] {
  const steps = new Set<FiscalWizardStepId>();
  (Object.keys(missing) as FiscalArea[]).forEach((area) => {
    (missing[area] ?? [])
      .filter((s) => s !== 'validation' && s !== 'area_selection')
      .forEach((s) => steps.add(s));
  });

  return FISCAL_STEP_ORDER.filter((s) => steps.has(s)).map((step) => {
    const label = stepLabel(step);
    return {
      id: `missing-step-${step}`,
      label,
      reason: reasonFor?.(step) ?? `Falta completar el paso "${label}".`,
      severity: 'required' as const,
      action: {
        label: `Volver a ${label}`,
        kind: 'navigate' as const,
        target: step,
      },
    };
  });
}

/**
 * Lee el mensaje humano de un error cubriendo las formas reales: string plano,
 * `Error`, `HttpErrorResponse` (`err.error.message`) o VendixHttpException
 * aplanado (`err.message`).
 */
function readBackendMessage(err: unknown): string | null {
  if (err === null || err === undefined) {
    return null;
  }
  if (typeof err === 'string') {
    const trimmed = err.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (err instanceof Error && typeof err.message === 'string') {
    const trimmed = err.message.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof err !== 'object') {
    return null;
  }
  const body = (err as { error?: unknown }).error;
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message.trim();
    }
  }
  const ownMessage = (err as { message?: unknown }).message;
  return typeof ownMessage === 'string' && ownMessage.trim().length > 0
    ? ownMessage.trim()
    : null;
}
