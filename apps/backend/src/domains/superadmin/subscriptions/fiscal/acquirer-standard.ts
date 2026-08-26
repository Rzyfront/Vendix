/**
 * Estandar de identidad fiscal del adquiriente para el riel plataforma.
 *
 * ## Que hace este modulo
 *
 * Recibe un adquiriente plano (la shape que `PlatformTenantsService` devuelve:
 * `tax_id`, `tax_id_dv`, `document_type`, `person_type`, `address`) y lo
 * enriquece con los campos que el wizard plataforma NECESITA para cumplir
 * el mismo estandar que el riel tienda ya implemento (hermano A.8,
 * `70e0f543d`):
 *
 *   - `dv_derived`: DV calculado con Modulo 11 desde `tax_id`. Es la fuente
 *     UNICA que el XML lleva; lo que la DIAN firma (ADR-9 decision producto:
 *     derivar-y-advertir).
 *   - `dv_mismatch`: `true` si el DV registrado difiere del derivado, con la
 *     advertencia auditable adjunta para que el frontend pueda pintarla. NO
 *     bloqueante: el XML sale con el DV derivado (correcto modulo 11) y la
 *     advertencia queda como recomendacion para sanear el registro del tenant.
 *   - `label_hint`: 'razon_social' si NIT, 'nombre_completo' si cedula o
 *     pasaporte. El campo de "Nombre" del wizard lo usa para decidir que
 *     etiqueta mostrar (decision del producto 2026-08-26).
 *   - `person_type_resolved`: para cedula/pasaporte se fija en '1' (Natural)
 *     sin posibilidad de cambio; para NIT respeta lo registrado o exige
 *     seleccion si viene null. Es la decision del mismo bloque: selector
 *     explicito solo si NIT.
 *   - `municipality_complete`: `true` si la direccion trae codigo DANE de
 *     municipio (no basta con nombre de ciudad). F.5 dispara el panel
 *     inline de saneamiento cuando es false.
 *
 * ## Por que aqui y no en PlatformTenantsService
 *
 * `PlatformTenantsService` resuelve busqueda y lookup; este modulo
 * DECORA la shape. Separarlos permite testear el estandar aislado, evita
 * acoplar `Tenants` con `nit.util` y deja el cable del frontend en una
 * sola transformacion (cualquier endpoint que devuelva un acquirer puede
 * pasarlo por aca).
 *
 * ## Lo que NO hace
 *
 * No escribe: la advertencia auditable se registra via `audit_logs` cuando
 * se EMITE la factura con DV divergente (siguiente slice). No consulta
 * `addresses`: recibe la direccion ya cargada. No aplica modulo 11 a
 * cedulas/pasaportes: solo NIT lleva DV en Colombia (Resolucion DIAN
 * 000070/2024 art. 11).
 */

import { computeNitDv } from '../../../../common/utils/nit.util';

/** Documentos que llevan DV en Colombia. Solo NIT, por ahora. */
const DOCUMENT_TYPES_WITH_DV = new Set(['NIT', 'nit', '31']);

/** Cedula y pasaporte: documento de persona natural, sin DV. */
const DOCUMENT_TYPES_NATURAL = new Set([
  'CC',
  'CE',
  'PA',
  '13',
  '22',
  'pet',
  'cedula',
]);

export type AcquirerLabelHint = 'razon_social' | 'nombre_completo';

export interface RawAcquirer {
  tax_id: string | null;
  tax_id_dv: string | null;
  document_type?: string | null;
  person_type?: string | null;
  address?: {
    line?: string | null;
    city?: string | null;
    department_code?: string | null;
    municipality_code?: string | null;
  } | null;
  /**
   * `TenantSearchResult` NO declara `document_type` ni `person_type` en su
   * shape minima del picker — vienen del tenant completo, no del resultado de
   * busqueda. Para el search endpoint, `enrichAcquirerForStandard` corre
   * igualmente y resuelve persona con lo que tenga (cedula por defecto a
   * Natural si document_type aparece, etc.). Sin document_type conocido,
   * `label_hint` cae a `nombre_completo` (conservador) y `person_type_resolved`
   * queda null.
   */
  [k: string]: unknown;
}

export interface EnrichedAcquirer extends RawAcquirer {
  /** DV calculado con Modulo 11 desde `tax_id`. La fuente unica del XML. */
  dv_derived: string | null;

  /**
   * `true` si el DV del registro del tenant difiere del derivado. NO
   * bloqueante: el XML lleva el derivado y se audita la divergencia al
   * emitir. `null` cuando no aplica (cedula, sin tax_id, etc.).
   */
  dv_mismatch: boolean | null;

  /**
   * `true` si el DV del registro coincide con el derivado. Util para que el
   * frontend muestre estado "validado" sin re-derivar.
   */
  dv_matches: boolean | null;

  /** Etiqueta dinamica que el formulario debe usar para el campo "Nombre". */
  label_hint: AcquirerLabelHint;

  /** Persona fijada/derivada ('1'=Natural, '2'=Juridica, `null`=indeterminado). */
  person_type_resolved: '1' | '2' | null;

  /** `true` si la direccion tiene codigo DANE de municipio (F.5). */
  municipality_complete: boolean;
}

/**
 * Enriquece un acquirer plano con los campos del estandar de identidad fiscal
 * del adquiriente (DV M11, label, persona, municipio DANE).
 *
 * Pura y sin I/O: cualquier endpoint que devuelva un acquirer puede pasarlo por
 * aca sin reescribir su firma.
 */
export function enrichAcquirerForStandard(raw: RawAcquirer): EnrichedAcquirer {
  const tax_id = raw.tax_id?.trim() ?? null;
  const tax_id_dv = raw.tax_id_dv?.trim() ?? null;
  const document_type = raw.document_type?.trim() ?? null;
  const person_type = raw.person_type?.trim() ?? null;
  const address = raw.address ?? null;

  const is_nit = document_type !== null && DOCUMENT_TYPES_WITH_DV.has(document_type);
  const is_natural_doc =
    document_type !== null && DOCUMENT_TYPES_NATURAL.has(document_type);

  // Derivacion DV (solo NIT). Cedula/pasaporte: dv_derived=null.
  const dv_derived = is_nit && tax_id ? computeNitDv(tax_id) : null;

  // Mismatch auditable: comparar DV registrado vs derivado.
  // `null` cuando no aplica (no es NIT, o falta tax_id).
  let dv_matches: boolean | null = null;
  let dv_mismatch: boolean | null = null;
  if (is_nit && tax_id && tax_id_dv && dv_derived) {
    dv_matches = tax_id_dv === dv_derived;
    dv_mismatch = !dv_matches;
  }

  // Etiqueta del campo Nombre: razon social para NIT, nombre completo
  // para cedula/pasaporte. Sin documento conocido: nombre_completo por
  // defecto (conservador).
  const label_hint: AcquirerLabelHint = is_nit ? 'razon_social' : 'nombre_completo';

  // Persona:
  //  - cedula/pasaporte -> SIEMPRE Natural ('1'), sin posibilidad de cambio
  //  - NIT -> respetar lo registrado; si null, dejar null para que la UI exija
  let person_type_resolved: '1' | '2' | null;
  if (is_natural_doc) {
    person_type_resolved = '1';
  } else if (is_nit) {
    person_type_resolved = person_type === '1' || person_type === '2' ? person_type : null;
  } else {
    person_type_resolved = person_type === '1' || person_type === '2' ? person_type : null;
  }

  // Municipio DANE: la direccion trae codigo DANE en `address.municipality_code`.
  // Si no esta (solo nombre de ciudad), el panel F.5 se dispara para sanear.
  const municipality_complete = Boolean(address?.municipality_code);

  return {
    ...raw,
    dv_derived,
    dv_mismatch,
    dv_matches,
    label_hint,
    person_type_resolved,
    municipality_complete,
  };
}
