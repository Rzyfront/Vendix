import { DIAN_ORGANIZATION_TYPES } from './dian-document-types';

/**
 * Overrides del PERFIL DIAN sobre `dian-ubl-content-model.ts`.
 *
 * `dian-ubl-content-model.ts` empieza con «GENERADO, NO EDITAR A MANO»: es una
 * traducción literal de los XSD de UBL 2.1 genérico, y se regenera con
 * `node scripts/generate-dian-ubl-content-model.js`. Cualquier ajuste manual
 * hecho ahí se perdería en la siguiente regeneración, y además falsearía un
 * archivo cuyo trabajo es documentar el ESQUEMA, no el perfil de un emisor
 * particular.
 *
 * El problema es que el esquema UBL genérico es, en varios puntos, más laxo
 * que lo que la DIAN acepta. `CustomerPartyType` declara
 * `cbc:AdditionalAccountID` con `min: 0, max: -1` (ilimitado) porque UBL
 * permite que un adquiriente tenga cualquier número de cuentas adicionales
 * identificadas por lo que sea. El Anexo Técnico de la DIAN, en cambio, sólo
 * usa ese elemento para UNA cosa —el tipo de persona del receptor, con
 * dominio `TipoOrganizacion-2.1.gc` ('1' jurídica, '2' natural)— y lo espera
 * exactamente una vez.
 *
 * ESTE ES EL CASO QUE PROBÓ QUE LA COMPUERTA FALTABA. `UblCommonBuilder`
 * emitía el código de persona y ADEMÁS un segundo `cbc:AdditionalAccountID`
 * como marcador de agente de retención ('3', que ni siquiera pertenece a la
 * lista oficial). Dos etiquetas son estructuralmente válidas para el XSD
 * genérico —`0..*` las admite sin quejarse—, así que `UblStructureValidator`
 * dejó pasar el documento. La DIAN lo rechazó en producción con:
 *
 *   «Receptor debe ser persona natural o jurídica
 *    (cac:AccountingCustomerParty/cbc:AdditionalAccountID)»
 *
 * un mensaje que no nombra el elemento sobrante ni explica que el límite es
 * `1`, no `-1`. Este archivo es donde vive esa diferencia entre «lo que UBL
 * permite» y «lo que el perfil DIAN exige»: se declara aparte, nunca dentro
 * de lo generado, y `UblStructureValidator` la consulta como una capa
 * adicional al recorrer cada tipo complejo.
 */

/**
 * Restricción del perfil DIAN sobre un hijo puntual de un tipo complejo.
 * Ambos campos son opcionales porque una entrada puede acotar sólo la
 * cardinalidad, sólo los valores permitidos, o ambos a la vez.
 */
export interface DianProfileChildRestriction {
  /**
   * Máximo de ocurrencias que el perfil DIAN admite. Se combina con el `max`
   * del modelo generado tomando el MÁS ESTRICTO de los dos — nunca reemplaza
   * un límite del XSD que ya sea más bajo que éste.
   */
  readonly max?: number;
  /**
   * Mínimo de ocurrencias que el perfil DIAN exige. Se combina con el `min`
   * del modelo generado tomando el MÁS ESTRICTO (el mayor) — nunca relaja un
   * mínimo del XSD. Un `min` mayor que el del XSD genera una violación
   * `'missing'` cuando el elemento no aparece.
   */
  readonly min?: number;
  /** Regla(s) DIAN citadas en el mensaje de la violación por `min`. */
  readonly dian_rule?: string;
  /**
   * Lista cerrada de valores de texto que el elemento puede tomar. Cualquier
   * otro valor —incluida una cadena vacía— es una violación `'bad-value'`.
   */
  readonly allowedValues?: readonly string[];
}

/** Overrides indexados por nombre de tipo complejo y por `ref` del hijo. */
export type DianProfileRestrictions = Readonly<
  Record<string, Readonly<Record<string, DianProfileChildRestriction>>>
>;

/**
 * Catálogo de overrides del perfil DIAN.
 *
 * Única entrada hoy: el receptor (`CustomerPartyType`) declara el tipo de
 * persona en `cbc:AdditionalAccountID` una sola vez, con un valor de
 * `DIAN_ORGANIZATION_TYPES` ('1' jurídica, '2' natural) — nunca escrito como
 * literal suelto aquí, para que una tercera fila que la DIAN agregue algún
 * día a `TipoOrganizacion-2.1.gc` sólo se edite en un sitio.
 *
 * Deliberadamente NO se aplica a `SupplierPartyType` (el emisor,
 * `cac:AccountingSupplierParty`): es un tipo complejo distinto en el modelo
 * generado, así que un override indexado por `CustomerPartyType` no lo toca.
 */
/** Sufijo de la clave para restricciones que sólo aplican a nivel documento. */
export const DOCUMENT_LEVEL_SUFFIX = '#document';

export const DIAN_PROFILE_RESTRICTIONS: DianProfileRestrictions = {
  CustomerPartyType: {
    'cbc:AdditionalAccountID': {
      max: 1,
      allowedValues: Object.values(DIAN_ORGANIZATION_TYPES),
    },
  },
  /**
   * Todo `cac:AllowanceCharge` (de línea o de documento). UBL deja `cbc:ID`,
   * `cbc:MultiplierFactorNumeric` y `cbc:BaseAmount` en `0..1`; el perfil DIAN
   * los exige. Caso que lo probó: VNDS3 rechazada (FBE01) porque el descuento
   * de línea salió sin `cbc:ID` ni `cbc:MultiplierFactorNumeric`.
   */
  AllowanceChargeType: {
    'cbc:ID': { min: 1, dian_rule: 'FBE01/FBE02' },
    'cbc:ChargeIndicator': { min: 1, dian_rule: 'FBE01/FBE03' },
    'cbc:MultiplierFactorNumeric': { min: 1, dian_rule: 'FBE01/FBE05' },
    'cbc:Amount': { min: 1, dian_rule: 'FBE01/FBE06' },
    'cbc:BaseAmount': { min: 1, dian_rule: 'FBE01/FBE08' },
  },
  /**
   * `cac:AllowanceCharge` hijo directo de la raíz del documento
   * (Invoice/CreditNote/DebitNote/documento soporte). Se suma a
   * `AllowanceChargeType` y reemplaza la regla citada (FAQ0x).
   */
  [`AllowanceChargeType${DOCUMENT_LEVEL_SUFFIX}`]: {
    'cbc:ID': { min: 1, dian_rule: 'FAQ01/FAQ02' },
    'cbc:ChargeIndicator': { min: 1, dian_rule: 'FAQ01/FAQ03' },
    'cbc:AllowanceChargeReasonCode': { min: 1, dian_rule: 'FAQ04' },
    'cbc:MultiplierFactorNumeric': { min: 1, dian_rule: 'FAQ01/FAQ06' },
    'cbc:Amount': { min: 1, dian_rule: 'FAQ01/FAQ07' },
    'cbc:BaseAmount': { min: 1, dian_rule: 'FAQ01/FAQ09' },
  },
};

/**
 * Consulta el override del perfil DIAN para un hijo, sin que el llamador
 * conozca la forma interna del catálogo. Devuelve `undefined` cuando el tipo
 * complejo o el hijo no tienen restricción declarada — el caso normal para
 * casi todo el modelo generado.
 */
export function getProfileRestriction(
  type_name: string,
  ref: string,
  document_level = false,
): DianProfileChildRestriction | undefined {
  const base = DIAN_PROFILE_RESTRICTIONS[type_name]?.[ref];
  if (!document_level) return base;
  const doc =
    DIAN_PROFILE_RESTRICTIONS[`${type_name}${DOCUMENT_LEVEL_SUFFIX}`]?.[ref];
  if (!doc) return base;
  return { ...base, ...doc };
}
