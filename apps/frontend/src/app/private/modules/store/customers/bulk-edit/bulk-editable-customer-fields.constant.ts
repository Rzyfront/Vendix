/**
 * Registro declarativo de los campos editables en masa de un cliente.
 *
 * Es el ESPEJO de `BulkEditableCustomerChangesDto` en el backend. Añadir un
 * campo aquí sin añadirlo allá produce un 400 (`forbidNonWhitelisted`), así que
 * el orden y el conjunto son contractuales.
 *
 * Cada entrada declara qué control lo pinta y —cuando aplica— de qué catálogo
 * salen sus opciones. El panel de cambios no conoce ningún campo por su nombre:
 * itera este registro, igual que hace el masivo de productos.
 */

import {
  FISCAL_RESPONSIBILITIES,
  getFiscalResponsibilityLabel,
} from '../../../../../shared/constants/fiscal-responsibilities.constants';
import { TAX_REGIMES } from '../../../../../shared/constants/tax-regime.constants';
import type { BulkEditableCustomerChanges } from './bulk-edit-customers.interface';

/** Clave de un campo editable. Derivada del contrato: no puede desviarse. */
export type BulkCustomerFieldKey = keyof BulkEditableCustomerChanges;

/** Control con el que se pinta un campo. */
export type BulkCustomerControlType =
  | 'text'
  | 'selector'
  | 'multiselect'
  | 'toggle'
  /** Tarifa: selector con la opción explícita «Sin tarifa» (sentinela → null). */
  | 'price-tier'
  /** Etiquetas CRM: modo añadir/quitar + multi-selector del catálogo. */
  | 'tag-action';

/** Bloque de UI al que pertenece un campo. */
export type BulkCustomerGroupKey = 'identity' | 'tax' | 'commercial';

export interface BulkCustomerFieldOption {
  value: string | number;
  label: string;
}

/** Origen de las opciones cuando el catálogo no es estático. */
export type BulkCustomerOptionsRef = 'price-tiers' | 'crm-tags';

export interface BulkCustomerField {
  key: BulkCustomerFieldKey;
  label: string;
  description?: string;
  group: BulkCustomerGroupKey;
  control: BulkCustomerControlType;
  /** Opciones estáticas (enums, catálogos que ya viven en el bundle). */
  options?: readonly BulkCustomerFieldOption[];
  /** Catálogo dinámico que la página resuelve antes de pintar. */
  optionsRef?: BulkCustomerOptionsRef;
  /** Largo máximo que acepta el backend (se aplica al input). */
  maxLength?: number;
  /** Valor que se envía cuando el input queda vacío. */
  emptyValue?: string | null;
}

export interface BulkCustomerFieldGroup {
  key: BulkCustomerGroupKey;
  label: string;
  icon: string;
  hint?: string;
}

export const BULK_CUSTOMER_FIELD_GROUPS: readonly BulkCustomerFieldGroup[] = [
  {
    key: 'identity',
    label: 'Identidad',
    icon: 'user',
    hint: 'Nombre y tipo de persona. El documento no se edita en lote: es único por organización.',
  },
  {
    key: 'tax',
    label: 'Datos fiscales',
    icon: 'receipt',
    hint: 'Se usan en la factura electrónica (Anexo Técnico 19).',
  },
  {
    key: 'commercial',
    label: 'Comercial',
    icon: 'tags',
    hint: 'Tarifa preferencial y etiquetas del CRM.',
  },
];

export const PERSON_TYPE_OPTIONS: readonly BulkCustomerFieldOption[] = [
  { value: 'NATURAL', label: 'Persona natural' },
  { value: 'JURIDICA', label: 'Persona jurídica' },
];

/** Opciones del catálogo RUT, con la etiqueta corta que ya usa el modal. */
export const FISCAL_RESPONSIBILITY_OPTIONS: readonly BulkCustomerFieldOption[] =
  FISCAL_RESPONSIBILITIES.map((code) => ({
    value: code,
    label: getFiscalResponsibilityLabel(code),
  }));

export const BULK_CUSTOMER_EDITABLE_FIELDS: readonly BulkCustomerField[] = [
  // ===== Identidad =====
  {
    key: 'first_name',
    label: 'Nombre',
    description: 'Vacío deja al cliente sin nombre; el backend lo bloquea si es una persona natural.',
    group: 'identity',
    control: 'text',
    maxLength: 100,
    emptyValue: '',
  },
  {
    key: 'last_name',
    label: 'Apellido',
    group: 'identity',
    control: 'text',
    maxLength: 100,
    emptyValue: '',
  },
  {
    key: 'legal_name',
    label: 'Razón social',
    description: 'Obligatoria de facto al marcar persona jurídica.',
    group: 'identity',
    control: 'text',
    maxLength: 255,
    emptyValue: null,
  },
  {
    key: 'person_type',
    label: 'Tipo de persona',
    description: 'Cambiar a jurídica exige razón social y vacía nombre/apellido.',
    group: 'identity',
    control: 'selector',
    options: PERSON_TYPE_OPTIONS,
  },
  {
    key: 'phone',
    label: 'Teléfono',
    description: 'Solo números y los símbolos + # * ( ) -',
    group: 'identity',
    control: 'text',
    maxLength: 50,
    emptyValue: null,
  },

  // ===== Fiscales =====
  {
    key: 'tax_regime',
    label: 'Régimen tributario',
    group: 'tax',
    control: 'selector',
    options: TAX_REGIMES.map((regime) => ({
      value: regime.value,
      label: regime.label,
    })),
  },
  {
    key: 'is_withholding_agent',
    label: 'Agente de retención',
    description: 'Activado: se marca en todos los seleccionados.',
    group: 'tax',
    control: 'toggle',
  },
  {
    key: 'ciiu_code',
    label: 'Código CIIU',
    description: 'Actividad económica del RUT, de 2 a 4 dígitos.',
    group: 'tax',
    control: 'text',
    maxLength: 10,
    emptyValue: null,
  },
  {
    key: 'fiscal_responsibilities',
    label: 'Responsabilidades fiscales',
    description: 'Reemplaza la lista completa del cliente con la que elijas.',
    group: 'tax',
    control: 'multiselect',
    options: FISCAL_RESPONSIBILITY_OPTIONS,
  },

  // ===== Comercial =====
  {
    key: 'price_tier_id',
    label: 'Tarifa preferencial',
    description:
      'Un cliente tiene UNA tarifa por tienda: asignarla sobrescribe la que tuviera. «Sin tarifa» la limpia.',
    group: 'commercial',
    control: 'price-tier',
    optionsRef: 'price-tiers',
  },
  {
    key: 'tag_action',
    label: 'Etiquetas del CRM',
    description:
      'Añade o quita etiquetas sin tocar las demás: no reemplaza el conjunto de cada cliente.',
    group: 'commercial',
    control: 'tag-action',
    optionsRef: 'crm-tags',
  },
];

/** Etiqueta humana de un campo del contrato (para diffs y resúmenes). */
export function findBulkCustomerField(
  key: string,
): BulkCustomerField | undefined {
  return BULK_CUSTOMER_EDITABLE_FIELDS.find((field) => field.key === key);
}

/** Bloques con sus campos, en el orden del registro. */
export function getBulkCustomerGroups(): Array<{
  group: BulkCustomerFieldGroup;
  fields: readonly BulkCustomerField[];
}> {
  return BULK_CUSTOMER_FIELD_GROUPS.map((group) => ({
    group,
    fields: BULK_CUSTOMER_EDITABLE_FIELDS.filter(
      (field) => field.group === group.key,
    ),
  }));
}

/**
 * Valor centinela de «Sin tarifa» en el selector.
 *
 * `app-selector` solo admite `string | number`, y `null` es indistinguible de
 * «no elegí» (dejaría el selector vacío y el campo no viajaría). Los ids reales
 * son enteros positivos, así que `0` no colisiona: `coerceCustomerFieldValue`
 * lo traduce a `null` en el payload.
 */
export const NO_PRICE_TIER_VALUE = 0;
