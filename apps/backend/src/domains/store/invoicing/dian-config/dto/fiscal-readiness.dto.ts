import type { ProductionReadinessReport } from '../../providers/fiscal-production-readiness.service';
import type {
  DianConfigurationType,
  FiscalDocumentType,
} from '../../fiscal-document-requirements';

/**
 * CONTRATO DE RESPUESTA DEL ESTADO FISCAL AGREGADO POR ENTIDAD.
 *
 * ## Por qué existe
 *
 * `GET /store/invoicing/dian-config/:id/production-readiness` responde por
 * `configId`: para preguntarle algo hay que saber ya que la configuración
 * existe. Eso deja sin respuesta la única pregunta que el comerciante se hace
 * al abrir el panel — «¿qué me falta en cada eje?» — porque los ejes que
 * todavía no tienen configuración no tienen id por el que preguntar.
 *
 * El resultado práctico: el documento soporte, la nómina y el documento
 * equivalente son INVISIBLES hasta que alguien los crea, y nadie los crea
 * porque no se ven. Este contrato invierte esa relación — los cuatro ejes se
 * declaran siempre y el que no está configurado se reporta como
 * `not_started`, no como ausencia.
 */

/**
 * Una resolución de numeración, SIN la clave técnica.
 *
 * La `technical_key` (ClTec) alimenta el CUFE de cada documento electrónico:
 * quien la tiene puede reconstruir la huella fiscal del comerciante. Por eso
 * se reporta ÚNICAMENTE su presencia y el valor no sale nunca del backend.
 * Misma decisión —y misma razón— que
 * `superadmin/tenant-config/tenant-resolutions.controller.ts::sinClaveTecnica`.
 */
export interface FiscalReadinessResolution {
  id: number;
  /**
   * Qué documento numera esta fila. Un eje agrupa varios documentos (la
   * habilitación `invoicing` cubre factura, nota crédito y nota débito), así
   * que sin este campo dos filas del mismo eje serían indistinguibles.
   */
  document_type: FiscalDocumentType;
  /**
   * El número que la DIAN autorizó, y su fecha. Viajan porque el formulario de
   * edición los exige: sin ellos el host pediría `GET resolutions` sólo para
   * rellenarlos, o el comerciante retecleaería a mano un número autorizado —que
   * es justo la clase de dato que un dedo cambia sin notarlo. No son secretos:
   * el único campo que nunca sale de aquí es la clave técnica.
   */
  resolution_number: string;
  resolution_date: Date;
  prefix: string | null;
  range_from: number;
  range_to: number;
  current_number: number;
  valid_from: Date;
  valid_to: Date;
  is_active: boolean;
  /** ¿Hay ClTec guardada? El valor NUNCA viaja. */
  technical_key_set: boolean;
}

/**
 * El estado de UNA de las cuatro habilitaciones DIAN.
 *
 * Siempre presente, tenga configuración o no: un eje que no aparece en la
 * lista se lee como «no aplica a este comerciante», que es justo la lectura
 * equivocada que hace invisible al documento soporte.
 */
export interface FiscalReadinessAxis {
  configuration_type: DianConfigurationType;
  /**
   * Rótulo en español. Derivado del contrato
   * (`requirementsFor(defaultDocumentTypeFor(tipo)).label`), no escrito a mano
   * aquí: un rótulo duplicado es un rótulo que se desincroniza.
   */
  label: string;
  /** `null` cuando el eje todavía no tiene configuración. */
  config_id: number | null;
  /** Ambiente REAL de la configuración; `null` cuando no hay ninguna. */
  environment: string | null;
  /** Estado REAL de la habilitación. `'not_started'` cuando no hay configuración. */
  enablement_status: string;
  /**
   * El checklist completo, evaluado COMO SI el eje ya estuviera en producción
   * —igual que `getProductionReadiness`— para que el comerciante vea los
   * requisitos que le faltan ADEMÁS de la promoción misma. `null` cuando no
   * hay configuración que evaluar.
   */
  readiness: ProductionReadinessReport | null;
  /**
   * Resoluciones de TODOS los documentos que cubre el eje, activas e
   * inactivas: la UI necesita poder mostrar una vencida para explicar por qué
   * el eje no emite.
   */
  resolutions: FiscalReadinessResolution[];
}

/** Respuesta completa: los cuatro ejes, siempre. */
export interface FiscalReadinessResponse {
  /**
   * Quién es el dueño fiscal de la configuración: `'ORGANIZATION'` significa
   * que se administra a nivel organización y que el alta desde la tienda está
   * bloqueada (ver `DianConfigService.create`). La UI lo necesita para no
   * ofrecer un botón que el backend va a rechazar.
   */
  fiscal_scope: string;
  axes: FiscalReadinessAxis[];
}
