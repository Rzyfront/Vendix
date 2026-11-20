import { normalizeNit } from '../../../../common/utils/nit.util';
import { normalizeLabel } from '@common/ai-ingest/sheets/sheet-parser.service';
import type {
  IngestRowIssue,
  IngestSkippedRow,
} from '@common/ai-ingest/ai-ingest.types';
import type {
  IngestProfile,
  IngestRowContext,
} from '@common/ai-ingest/profiles/ingest-profile.interface';
import type { ExtractionSchema } from '@common/ai-ingest/extraction/ai-extraction.service';
import { addressKey } from './customer-ai-import.util';
import {
  IMPORT_MAX_LOCATIONS,
  IMPORT_MAX_SHEET_ROWS,
  ImportCustomer,
  ImportLocation,
} from './dto/customer-ai-import.dto';

/**
 * ai-ingest profile `customers` (ia-cargas F1): how a customer spreadsheet is
 * read without AI. Columns map by synonyms; each row is normalized by code
 * (document without dots, NIT DV with `normalizeNit`, phones, e-mails) and
 * only the genuinely ambiguous cells go to the model in batches:
 *
 * - `name_split`: a single "full name" column that is not 1, 2 or 4 words,
 * - `address_city`: words after the street number may be the city and there
 *   is no city column or separator,
 * - `document_type`: the document cell carries words the code cannot read.
 */
export type CustomerSheetField =
  | 'full_name'
  | 'first_name'
  | 'last_name'
  | 'legal_name'
  | 'person_type'
  | 'document_type'
  | 'document_number'
  | 'verification_digit'
  | 'email'
  | 'phone'
  | 'address'
  | 'address_line_2'
  | 'city'
  | 'state'
  | 'municipality_code'
  | 'location_label'
  | 'location_phone';

export const CUSTOMER_SHEET_FIELDS: CustomerSheetField[] = [
  'full_name',
  'first_name',
  'last_name',
  'legal_name',
  'person_type',
  'document_type',
  'document_number',
  'verification_digit',
  'email',
  'phone',
  'address',
  'address_line_2',
  'city',
  'state',
  'municipality_code',
  'location_label',
  'location_phone',
];

/** What each field means, for the single AI column-mapping call. */
export const CUSTOMER_FIELD_DESCRIPTIONS: Record<CustomerSheetField, string> = {
  full_name: 'full name of a person or company in one column',
  first_name: 'given names only',
  last_name: 'surnames only',
  legal_name: 'company legal name (razón social)',
  person_type: 'natural / jurídica',
  document_type: 'document type (CC, CE, NIT, TI, PA, PEP, PPT, RC)',
  document_number: 'document / NIT / cédula number',
  verification_digit: 'NIT verification digit (DV)',
  email: 'e-mail',
  phone: 'customer phone / mobile',
  address: 'street address',
  address_line_2: 'address complement or neighbourhood',
  city: 'city / municipality',
  state: 'department / state',
  municipality_code: 'DANE municipality code (5 digits)',
  location_label: 'branch / store / site name of the customer',
  location_phone: 'phone of the branch',
};

/** Labels compared accent-free and lower-case (`normalizeLabel`). */
export const CUSTOMER_COLUMN_SYNONYMS: Record<CustomerSheetField, string[]> = {
  full_name: [
    'nombre',
    'nombre completo',
    'nombres y apellidos',
    'nombre y apellido',
    'nombre del cliente',
    'nombre cliente',
    'cliente',
    'tercero',
    'nombre tercero',
    'nombre o razon social',
    'razon social o nombre',
    'nombre razon social',
    'name',
    'full name',
    'customer',
    'customer name',
  ],
  first_name: ['nombres', 'primer nombre', 'first name', 'given name'],
  last_name: ['apellidos', 'apellido', 'primer apellido', 'last name', 'surname'],
  legal_name: ['razon social', 'empresa', 'nombre empresa', 'nombre de la empresa', 'company', 'company name'],
  person_type: ['tipo persona', 'tipo de persona', 'person type'],
  document_type: [
    'tipo documento',
    'tipo de documento',
    'tipo doc',
    'tipo identificacion',
    'tipo de identificacion',
    'tipo id',
    'document type',
  ],
  document_number: [
    'documento',
    'numero documento',
    'numero de documento',
    'no documento',
    'nro documento',
    'num documento',
    'documento de identidad',
    'identificacion',
    'numero identificacion',
    'numero de identificacion',
    'nit',
    'cedula',
    'cc',
    'nit cc',
    'cc nit',
    'nit o cc',
    'cedula nit',
    'nit cedula',
    'rut',
    'document',
    'id',
  ],
  verification_digit: ['dv', 'digito verificacion', 'digito de verificacion', 'digito'],
  email: ['correo', 'email', 'e mail', 'correo electronico', 'mail', 'correo e'],
  phone: [
    'telefono',
    'celular',
    'movil',
    'tel',
    'telefono celular',
    'numero de telefono',
    'numero celular',
    'whatsapp',
    'phone',
    'mobile',
    'contacto',
  ],
  address: [
    'direccion',
    'direccion de entrega',
    'direccion principal',
    'direccion cliente',
    'domicilio',
    'address',
  ],
  address_line_2: ['complemento', 'barrio', 'detalle direccion', 'direccion 2'],
  city: ['ciudad', 'municipio', 'poblacion', 'localidad', 'city'],
  state: ['departamento', 'depto', 'dpto', 'provincia', 'state'],
  municipality_code: ['codigo municipio', 'codigo dane', 'dane', 'cod dane', 'cod municipio'],
  location_label: ['sede', 'sucursal', 'nombre sede', 'punto de venta', 'establecimiento', 'nombre establecimiento'],
  location_phone: ['telefono sede', 'telefono sucursal', 'telefono establecimiento'],
};

export type CustomerAiNeed = 'name_split' | 'address_city' | 'document_type';

/** One sheet row after deterministic normalization (before AI/merge). */
export interface CustomerRowDraft {
  row: number;
  sheet?: string;
  /** Raw mapped cells, sent to the model only when `needs` is not empty. */
  raw: Partial<Record<CustomerSheetField, string>>;
  needs: CustomerAiNeed[];
  person_type: 'NATURAL' | 'JURIDICA' | null;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  document_type: string | null;
  document_number: string | null;
  verification_digit: string | null;
  email: string | null;
  phone: string | null;
  location: ImportLocation | null;
}

/** Answer entry of the AI row-normalization batch. */
export interface CustomerAiRow {
  row_id: number;
  person_type?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  legal_name?: string | null;
  document_type?: string | null;
  document_number?: string | null;
  verification_digit?: string | null;
  address_line_1?: string | null;
  city?: string | null;
  state?: string | null;
}

const nullableString = { type: ['string', 'null'] };

export const CUSTOMER_ROWS_SCHEMA: ExtractionSchema = {
  name: 'customer_rows',
  schema: {
    type: 'object',
    required: ['customers'],
    properties: {
      customers: {
        type: 'array',
        items: {
          type: 'object',
          required: ['row_id'],
          properties: {
            row_id: { type: 'integer' },
            person_type: { type: ['string', 'null'], enum: ['NATURAL', 'JURIDICA', null] },
            first_name: nullableString,
            last_name: nullableString,
            legal_name: nullableString,
            document_type: nullableString,
            document_number: nullableString,
            verification_digit: nullableString,
            address_line_1: nullableString,
            city: nullableString,
            state: nullableString,
          },
        },
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
};

/** Schema of the image/PDF path (same shape the app prompt asks for). */
export const CUSTOMER_DOCUMENT_SCHEMA: ExtractionSchema = {
  name: 'customer_document',
  schema: {
    type: 'object',
    required: ['customers'],
    properties: {
      customers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            person_type: { type: ['string', 'null'] },
            first_name: nullableString,
            last_name: nullableString,
            legal_name: nullableString,
            document_type: nullableString,
            document_number: nullableString,
            verification_digit: nullableString,
            email: nullableString,
            phone: nullableString,
            locations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: nullableString,
                  address_line_1: nullableString,
                  address_line_2: nullableString,
                  city: nullableString,
                  state: nullableString,
                  municipality_code: nullableString,
                  phone: nullableString,
                },
              },
            },
          },
        },
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic helpers
// ─────────────────────────────────────────────────────────────────────────────

const DOCUMENT_TYPE_WORDS: [RegExp, string][] = [
  [/^(c ?c|cedula( de)?( ciudadania)?|cedula de ciudadania|cedula ciudadania)$/, 'CC'],
  [/^(c ?e|cedula( de)? extranjeria|extranjeria)$/, 'CE'],
  [/^(n ?i ?t|rut)$/, 'NIT'],
  [/^(t ?i|tarjeta( de)? identidad)$/, 'TI'],
  [/^(p ?a|pp|pasaporte|passport)$/, 'PA'],
  [/^pep$/, 'PEP'],
  [/^ppt$/, 'PPT'],
  [/^(r ?c|registro civil)$/, 'RC'],
];

/** "C.C.", "Cédula de ciudadanía", "nit" … → CC/NIT…; null when unknown. */
export function documentTypeFromText(value: string | null | undefined): string | null {
  const label = normalizeLabel(value ?? '');
  if (!label) return null;
  for (const [pattern, type] of DOCUMENT_TYPE_WORDS) {
    if (pattern.test(label)) return type;
  }
  return null;
}

const COMPANY_MARKERS =
  /\b(s ?a ?s|s ?a|ltda|limitada|e ?u|s en c|sociedad|cia|compania|corporacion|corp|inc|llc|fundacion|asociacion|cooperativa|coop|distribuidora|distribuciones|comercializadora|inversiones|grupo|ips|eps|e ?s ?p|universidad|colegio|institucion|ministerio|alcaldia|gobernacion|hospital|clinica|ferreteria|drogueria|supermercado|restaurante|hotel|almacen|industrias|servicios|soluciones|consultores|constructora|transportes|importadora|laboratorio)\b/;

export function looksLikeCompany(name: string): boolean {
  return COMPANY_MARKERS.test(normalizeLabel(name));
}

function clean(value: string | null | undefined): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v ? v : null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ParsedDocument {
  document_type: string | null;
  document_number: string | null;
  verification_digit: string | null;
  needsAi: boolean;
  issues: string[];
}

/**
 * Document cells as people type them: "900.123.456-7", "CC 1.020.304",
 * "NIT: 900123456", separate type and DV columns. A NIT keeps its number
 * without the DV; a wrong DV is replaced by the computed one and reported.
 */
export function parseDocument(
  numberRaw: string | undefined,
  typeRaw: string | undefined,
  dvRaw: string | undefined,
): ParsedDocument {
  const issues: string[] = [];
  let type = documentTypeFromText(typeRaw);
  let needsAi = !!clean(typeRaw) && !type;
  let value = clean(numberRaw) ?? '';

  // Type written inside the number cell: "CC 1020304050", "NIT: 900…".
  const prefix = /^([A-Za-zÁÉÍÓÚáéíóúÑñ. ]+?)[\s:#.-]*(?=[\d])/.exec(value);
  if (prefix) {
    const fromPrefix = documentTypeFromText(prefix[1]);
    if (fromPrefix) {
      type = type ?? fromPrefix;
      value = value.slice(prefix[0].length);
    } else if (!type) {
      needsAi = true;
    }
  }

  if (!value) {
    return { document_type: type, document_number: null, verification_digit: null, needsAi: false, issues };
  }

  const hasLetters = /[A-Za-z]/.test(value);
  const dashDv = /^[\d.,\s]+-\s*\d$/.test(value);
  const digits = value.replace(/[^\d]/g, '');
  const looksNit = !hasLetters && (dashDv || (digits.length === 9 && /^[89]/.test(digits)));

  if (!type) {
    if (clean(dvRaw) || looksNit) type = 'NIT';
    else if (hasLetters) needsAi = true;
  }

  if (type === 'NIT' && !hasLetters) {
    const nit = normalizeNit(dashDv ? value : digits);
    const provided = nit.provided_dv ?? (clean(dvRaw)?.replace(/\D/g, '') || null);
    if (provided && provided !== nit.dv) {
      issues.push(
        `El dígito de verificación ${provided} no corresponde al NIT ${nit.number}; se usará ${nit.dv}.`,
      );
    }
    return {
      document_type: 'NIT',
      document_number: nit.number || null,
      verification_digit: nit.dv || null,
      needsAi,
      issues,
    };
  }

  const number = value.replace(/[^0-9A-Za-z]/g, '') || null;
  if (!type && number && !hasLetters && !needsAi) {
    type = 'CC';
    issues.push('El tipo de documento no venía en la hoja; se asumió CC. Revísalo.');
  }
  return { document_type: type, document_number: number, verification_digit: null, needsAi, issues };
}

/** First valid e-mail of the cell; the rest is reported. */
export function parseEmail(raw: string | undefined): { email: string | null; issues: string[] } {
  const parts = (raw ?? '')
    .split(/[;,\s/]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return { email: null, issues: [] };
  const valid = parts.filter((p) => EMAIL_PATTERN.test(p));
  const issues: string[] = [];
  if (!valid.length) {
    issues.push(`El correo "${raw?.trim()}" no es válido; se dejó vacío.`);
    return { email: null, issues };
  }
  if (parts.length > 1) issues.push(`Había varios correos; se tomó ${valid[0]}.`);
  return { email: valid[0], issues };
}

/** First phone of the cell, digits only (keeps a leading +). */
export function parsePhone(raw: string | undefined): { phone: string | null; issues: string[] } {
  const parts = (raw ?? '')
    .split(/[;/|,]| - | y /)
    .map((p) => p.trim())
    .filter((p) => /\d/.test(p));
  if (!parts.length) return { phone: null, issues: [] };
  const first = parts[0];
  const phone = (first.trim().startsWith('+') ? '+' : '') + first.replace(/\D/g, '');
  const issues: string[] = [];
  if (parts.length > 1) issues.push(`Había varios teléfonos; se tomó ${phone}.`);
  if (phone.replace(/\D/g, '').length < 7) issues.push(`El teléfono ${phone} parece incompleto.`);
  return { phone, issues };
}

/**
 * "Cra 7 # 12-34, Bogotá" → address + city; "…, Medellín, Antioquia" → city
 * + state. Only trailing pieces made of letters count as city/state.
 */
export function splitAddressCity(address: string): {
  address_line_1: string;
  city: string | null;
  state: string | null;
} {
  const parts = address.split(/\s*,\s*|\s+-\s+/).filter(Boolean);
  const isPlace = (p: string) => /^[A-Za-zÁÉÍÓÚÜáéíóúüÑñ. ]{3,40}$/.test(p) && p.split(' ').length <= 4;
  if (parts.length >= 3 && isPlace(parts[parts.length - 1]) && isPlace(parts[parts.length - 2])) {
    return {
      address_line_1: parts.slice(0, -2).join(', '),
      city: parts[parts.length - 2],
      state: parts[parts.length - 1],
    };
  }
  if (parts.length >= 2 && isPlace(parts[parts.length - 1])) {
    return { address_line_1: parts.slice(0, -1).join(', '), city: parts[parts.length - 1], state: null };
  }
  return { address_line_1: address, city: null, state: null };
}

/** Colombian convention: 2 words = 1+1, 4 words = 2+2; anything else is ambiguous. */
export function splitPersonName(full: string): {
  first_name: string;
  last_name: string | null;
  ambiguous: boolean;
} {
  const words = full.split(' ').filter(Boolean);
  if (words.length === 1) return { first_name: words[0], last_name: null, ambiguous: false };
  if (words.length === 2) return { first_name: words[0], last_name: words[1], ambiguous: false };
  if (words.length === 4) {
    return { first_name: words.slice(0, 2).join(' '), last_name: words.slice(2).join(' '), ambiguous: false };
  }
  // Fallback while the model answers (or if it cannot): one given name.
  const given = words.length >= 5 ? 2 : 1;
  return {
    first_name: words.slice(0, given).join(' '),
    last_name: words.slice(given).join(' '),
    ambiguous: true,
  };
}

function personTypeFromText(value: string | undefined): 'NATURAL' | 'JURIDICA' | null {
  const label = normalizeLabel(value ?? '');
  if (/juridic|empresa|sociedad|company/.test(label)) return 'JURIDICA';
  if (/natural|persona|person/.test(label)) return 'NATURAL';
  return null;
}

/** Deterministic normalization of one mapped row; `record` absent = skipped. */
export function normalizeCustomerRow(
  raw: Partial<Record<CustomerSheetField, string>>,
  ctx: IngestRowContext,
): { record?: CustomerRowDraft; issues: IngestRowIssue[]; skipMessage?: string } {
  const issues: IngestRowIssue[] = [];
  const issue = (message: string, field?: string, level: 'warning' | 'error' = 'warning') =>
    issues.push({ row: ctx.row, ...(ctx.sheet ? { sheet: ctx.sheet } : {}), level, field, message });
  const needs: CustomerAiNeed[] = [];

  // Name
  let personType = personTypeFromText(raw.person_type);
  let firstName = clean(raw.first_name);
  let lastName = clean(raw.last_name);
  let legalName = clean(raw.legal_name);
  const fullName = clean(raw.full_name);

  // Document (decides NIT before the name heuristics)
  const doc = parseDocument(raw.document_number, raw.document_type, raw.verification_digit);
  doc.issues.forEach((m) => issue(m, 'document_number'));
  if (doc.needsAi) needs.push('document_type');

  if (!legalName && !firstName && fullName) {
    if (personType === 'JURIDICA' || looksLikeCompany(fullName)) {
      legalName = fullName;
      personType = personType ?? 'JURIDICA';
    } else {
      const split = splitPersonName(fullName);
      firstName = split.first_name;
      lastName = lastName ?? split.last_name;
      if (split.ambiguous) needs.push('name_split');
    }
  }
  if (!personType && legalName && !firstName) personType = 'JURIDICA';

  const { email, issues: emailIssues } = parseEmail(raw.email);
  emailIssues.forEach((m) => issue(m, 'email'));
  const { phone, issues: phoneIssues } = parsePhone(raw.phone);
  phoneIssues.forEach((m) => issue(m, 'phone'));

  // Location
  let address = clean(raw.address);
  let city = clean(raw.city);
  let state = clean(raw.state);
  if (address && !city) {
    const split = splitAddressCity(address);
    if (split.city) {
      address = split.address_line_1;
      city = split.city;
      state = state ?? split.state;
    } else if (/[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]{3,}/.test(address.replace(/^.*\d/, ''))) {
      // Words after the street number ("Cl 10 # 5-20 Bogotá") may be the
      // city; "Cra 1 # 2-3" alone has none and does not need the model.
      needs.push('address_city');
    }
  }
  const label = clean(raw.location_label);
  const code = clean(raw.municipality_code);
  const locationPhone = clean(raw.location_phone);
  const location: ImportLocation | null =
    address || city || label
      ? {
          label,
          address_line_1: address,
          address_line_2: clean(raw.address_line_2),
          city,
          state,
          municipality_code: code && /^\d{5}$/.test(code) ? code : null,
          phone: locationPhone ? parsePhone(locationPhone).phone : null,
        }
      : null;

  const identifies = firstName || legalName || doc.document_number || email || phone;
  if (!identifies) {
    return {
      issues: [],
      skipMessage: 'Sin nombre, documento, correo ni teléfono: no se puede crear el cliente.',
    };
  }

  return {
    record: {
      row: ctx.row,
      ...(ctx.sheet ? { sheet: ctx.sheet } : {}),
      raw,
      needs,
      person_type: personType,
      first_name: firstName,
      last_name: lastName,
      legal_name: legalName,
      document_type: doc.document_type,
      document_number: doc.document_number,
      verification_digit: doc.verification_digit,
      email,
      phone,
      location,
    },
    issues,
  };
}

/** Applies the model answer only to the fields the row needed. */
export function applyCustomerAiRow(draft: CustomerRowDraft, ai: CustomerAiRow): CustomerRowDraft {
  const next: CustomerRowDraft = { ...draft };
  const v = (value: string | null | undefined) => clean(value ?? null);
  if (draft.needs.includes('name_split')) {
    const legal = v(ai.legal_name);
    const juridica = ai.person_type === 'JURIDICA' || (!!legal && !v(ai.first_name));
    if (juridica && legal) {
      next.legal_name = legal;
      next.first_name = null;
      next.last_name = null;
      next.person_type = 'JURIDICA';
    } else if (v(ai.first_name)) {
      next.first_name = v(ai.first_name);
      next.last_name = v(ai.last_name);
      next.person_type = next.person_type ?? 'NATURAL';
    }
  }
  if (draft.needs.includes('document_type')) {
    next.document_type = v(ai.document_type) ?? next.document_type;
    if (v(ai.document_number)) {
      next.document_number = (ai.document_number ?? '').replace(/[^0-9A-Za-z]/g, '') || next.document_number;
    }
    if (next.document_type === 'NIT' && next.document_number && /^\d+$/.test(next.document_number)) {
      next.verification_digit = normalizeNit(next.document_number).dv || null;
    }
  }
  if (draft.needs.includes('address_city') && draft.location) {
    next.location = {
      ...draft.location,
      address_line_1: v(ai.address_line_1) ?? draft.location.address_line_1,
      city: v(ai.city) ?? draft.location.city,
      state: v(ai.state) ?? draft.location.state,
    };
  }
  return next;
}

/** Spanish note for a row whose ambiguous cells the model could not resolve. */
export function unresolvedNeedsMessage(needs: CustomerAiNeed[]): string {
  const parts = needs.map((n) =>
    n === 'name_split'
      ? 'separar nombres y apellidos'
      : n === 'address_city'
        ? 'separar la ciudad de la dirección'
        : 'reconocer el tipo de documento',
  );
  return `No se pudo ${parts.join(', ')} automáticamente; revísalo antes de crear el lote.`;
}

/** Row message for the model (only the raw cells it needs). */
export function customerAiRowPayload(id: number, draft: CustomerRowDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { row_id: id };
  for (const [key, value] of Object.entries(draft.raw)) {
    if (value) out[key] = value;
  }
  return out;
}

export interface CustomerWithRows extends ImportCustomer {
  source_rows: number[];
  source_sheet?: string;
}

/**
 * Folds rows with the same (type, number) into one customer with several
 * locations; a row that adds nothing new is reported as `duplicate`.
 */
export function mergeCustomerRows(
  customers: CustomerWithRows[],
): { customers: CustomerWithRows[]; skipped: IngestSkippedRow[] } {
  const out: CustomerWithRows[] = [];
  const skipped: IngestSkippedRow[] = [];
  const byKey = new Map<string, CustomerWithRows>();
  const fields = [
    'person_type',
    'first_name',
    'last_name',
    'legal_name',
    'verification_digit',
    'email',
    'phone',
  ] as const;

  for (const c of customers) {
    const key = c.document_number ? `${c.document_type ?? ''}|${c.document_number.toLowerCase()}` : null;
    const base = key ? byKey.get(key) : undefined;
    if (!key || !base) {
      if (key) byKey.set(key, c);
      out.push(c);
      continue;
    }
    let added = false;
    for (const field of fields) {
      if (base[field] === null && c[field] !== null) {
        (base as unknown as Record<string, unknown>)[field] = c[field];
        added = true;
      }
    }
    const known = new Set(base.locations.map((l) => `${addressKey(l.address_line_1)}|${addressKey(l.city)}`));
    for (const loc of c.locations) {
      const lk = `${addressKey(loc.address_line_1)}|${addressKey(loc.city)}`;
      if (known.has(lk) || base.locations.length >= IMPORT_MAX_LOCATIONS) continue;
      known.add(lk);
      base.locations.push(loc);
      added = true;
    }
    const row = c.source_rows[0];
    if (added) {
      base.source_rows.push(...c.source_rows);
    } else {
      skipped.push({
        row,
        ...(c.source_sheet ? { sheet: c.source_sheet } : {}),
        reason: 'duplicate',
        message: `Mismo cliente que la fila ${base.source_rows[0]} (documento ${c.document_number}) y no trae datos nuevos.`,
      });
    }
  }
  return { customers: out, skipped };
}

export const customersIngestProfile: IngestProfile<CustomerRowDraft, CustomerSheetField> = {
  key: 'customers',
  appKey: 'customer_import_ocr',
  recordSchema: CUSTOMER_ROWS_SCHEMA,
  columnSynonyms: CUSTOMER_COLUMN_SYNONYMS,
  requiredFields: [['full_name', 'first_name', 'legal_name']],
  normalizeRow: (raw, ctx) => {
    const { record, issues } = normalizeCustomerRow(raw, ctx);
    return { record, issues };
  },
  dedupeKey: (r) =>
    r.document_number ? `${r.document_type ?? ''}|${r.document_number.toLowerCase()}` : null,
  limits: {
    maxRows: IMPORT_MAX_SHEET_ROWS,
    maxPages: 10,
    rowsPerBatch: 50,
    pagesPerBatch: 1,
    maxBytes: { sheet: 5 * 1024 * 1024, pdf: 10 * 1024 * 1024, image: 10 * 1024 * 1024 },
  },
  mode: 'list',
};
