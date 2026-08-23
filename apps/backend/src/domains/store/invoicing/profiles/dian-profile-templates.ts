import { DIAN_INVOICE_OPERATION_TYPES } from '../providers/dian-direct/constants/dian-document-types';
import {
  INVOICE_PROFILE_CONFIG_VERSION,
  InvoiceProfileConfig,
} from './invoice-profile-config.contract';

/**
 * Plantillas de perfil de facturación — ADR-10.
 *
 * ## Por qué son constante y no dato
 *
 * Una tabla global de plantillas editables sería una superficie de escritura
 * cross-tenant sobre reglas FISCALES: quien la edite cambia la configuración
 * inicial de todos los tenants de una industria. Como constante, una reforma
 * tributaria es un cambio de código con revisión y trazabilidad en git, y los
 * perfiles ya creados no se alteran —son snapshots inmutables (ADR-1)—, así que
 * publicar una plantilla nueva no reescribe configuración histórica.
 *
 * Coste aceptado: publicar una plantilla exige deploy.
 *
 * ## Por qué hay DOS plantillas AIU y no una
 *
 * Los dos regímenes AIU son bases gravables incompatibles y la diferencia no es
 * de matiz: bajo el E.T. art. 462-1 el IVA se calcula sobre A+I+U, bajo el
 * Decreto 1372/1992 sólo sobre la utilidad. Una única plantilla «AIU» tendría
 * que elegir uno por omisión, y el usuario que aceptara el default sin leerlo
 * emitiría con el régimen equivocado: si el elegido fuera el 1372 y su actividad
 * fuera del 462-1, cada factura declararía de MENOS ante la DIAN, que es sanción
 * e intereses y sólo se corrige con nota crédito. Con dos plantillas, elegir el
 * régimen es un acto explícito y nombrado por la actividad, no un default.
 */
export const DIAN_PROFILE_TEMPLATE_VERSION = 1;

export interface DianProfileTemplate {
  key: string;
  label: string;
  /** Para qué actividad es, en el lenguaje del operador — no en el de la norma. */
  description: string;
  operation_type: string;
  /** Versión de la PLANTILLA, distinta de `config.config_version` (la del snapshot). */
  template_version: number;
  config: InvoiceProfileConfig;
}

/** Base común: lo que ninguna plantilla necesita variar. */
const emptySections = {
  general: { description: null, internal_note: null },
  accounting: {
    revenue_account_by_bucket: null,
    vat_payable_account: null,
    mapping_key_overrides: null,
  },
  model_lines: [],
  format: {
    template_id: null,
    template_key: null,
    show_aiu_breakdown: false,
    display_decimals: 2,
  },
  dian: {
    payment_means_code: null,
    payment_method_code: null,
    header_notes: null,
  },
} as const;

export const DIAN_PROFILE_TEMPLATES: readonly DianProfileTemplate[] = [
  {
    key: 'dian-standard',
    label: 'Factura estándar DIAN',
    description:
      'Venta normal de bienes o servicios. Es el caso de la mayoría de los negocios.',
    operation_type: DIAN_INVOICE_OPERATION_TYPES.STANDARD,
    template_version: DIAN_PROFILE_TEMPLATE_VERSION,
    config: {
      config_version: INVOICE_PROFILE_CONFIG_VERSION,
      ...emptySections,
      // Sin sección AIU: un perfil estándar con una sección AIU a medias es un
      // perfil que podría emitir un documento AIU sin que nadie lo decidiera.
      aiu: null,
      // Sin reglas: en una venta ordinaria el impuesto lo declara la línea desde
      // el catálogo de tarifas del producto. La matriz existe para repartir un
      // AIU entre porciones gravables y no gravables, que acá no ocurre.
      taxes: { rules: [] },
    },
  },
  {
    key: 'dian-aiu-462-1',
    label: 'AIU — aseo, vigilancia y servicios temporales (E.T. 462-1)',
    description:
      'Contratos de aseo y cafetería, vigilancia, y empresas de servicios temporales. El IVA se calcula sobre el AIU completo (administración + imprevistos + utilidad), con un piso del 10% del valor del contrato.',
    operation_type: DIAN_INVOICE_OPERATION_TYPES.AIU,
    template_version: DIAN_PROFILE_TEMPLATE_VERSION,
    config: {
      config_version: INVOICE_PROFILE_CONFIG_VERSION,
      ...emptySections,
      format: { ...emptySections.format, show_aiu_breakdown: true },
      aiu: {
        regime: 'et_462_1',
        contract_object: '',
        enforce_minimum_base: true,
        minimum_base_percent: '10.00',
        // Porcentajes del VALOR DEL CONTRATO, no del AIU: su suma (10 %) es el
        // AIU, y es exactamente el piso del art. 462-1. Asi se redacta el
        // contrato y asi la compuerta `AIU_PERCENT_SUM_BELOW_FLOOR` puede
        // comprobar el piso al guardar el perfil, sin esperar a la emision.
        components_basis: 'contract',
        components: {
          administracion: '5.00',
          imprevistos: '2.00',
          utilidad: '3.00',
        },
      },
      taxes: {
        rules: [
          { bucket: 'administracion', taxable: true, tax_code: '01', rate: '19.00' },
          { bucket: 'imprevistos', taxable: true, tax_code: '01', rate: '19.00' },
          { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
          { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
        ],
      },
    },
  },
  {
    key: 'dian-aiu-1372',
    label: 'AIU — construcción de bien inmueble (Decreto 1372/1992)',
    description:
      'Contratos de construcción de bien inmueble. El IVA se calcula únicamente sobre la utilidad; la administración y los imprevistos no entran a la base gravable.',
    operation_type: DIAN_INVOICE_OPERATION_TYPES.AIU,
    template_version: DIAN_PROFILE_TEMPLATE_VERSION,
    config: {
      config_version: INVOICE_PROFILE_CONFIG_VERSION,
      ...emptySections,
      format: { ...emptySections.format, show_aiu_breakdown: true },
      aiu: {
        regime: 'decreto_1372_1992',
        contract_object: '',
        // El piso del 10% es una regla del E.T. 462-1, no del Decreto 1372: acá
        // no rige. Se deja el 10.00 y no un 0.00 porque si alguien cambiara el
        // régimen a 462-1 sin revisar el piso, el 10.00 es el valor legal y el
        // 0.00 permitiría en silencio una base gravable de cero.
        enforce_minimum_base: false,
        minimum_base_percent: '10.00',
        // Del valor del contrato. Bajo el Decreto 1372 solo la utilidad grava,
        // asi que el % de utilidad ES la base gravable del documento como
        // porcentaje del contrato — el numero que hay que revisar dos veces.
        components_basis: 'contract',
        components: {
          administracion: '5.00',
          imprevistos: '2.00',
          utilidad: '3.00',
        },
      },
      taxes: {
        rules: [
          // `rate: '0.00'` con `taxable: false` no es «IVA al 0%»: es la ausencia
          // de grupo de impuesto en la línea (regla CAX01 del anexo). Una tarifa
          // distinta de cero acá sería exactamente el descuadre que la DIAN
          // rechaza por FAU04.
          { bucket: 'administracion', taxable: false, tax_code: '01', rate: '0.00' },
          { bucket: 'imprevistos', taxable: false, tax_code: '01', rate: '0.00' },
          { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
          { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
        ],
      },
    },
  },
];

/** Búsqueda por clave. `undefined` si la plantilla no existe. */
export function findDianProfileTemplate(
  key: string,
): DianProfileTemplate | undefined {
  return DIAN_PROFILE_TEMPLATES.find((template) => template.key === key);
}
