import type { IngestRowContext, IngestProfile } from '@common/ai-ingest/profiles/ingest-profile.interface';
import type { IngestRowIssue } from '@common/ai-ingest/ai-ingest.types';
import type { ExtractionSchema } from '@common/ai-ingest/extraction/ai-extraction.service';
import type { ExtractedMember, ExtractedPlan } from './dto/scan-roster.dto';

/**
 * ai-ingest profile of the member roster ("Carga masiva de socios", plan
 * ia-cargas F2 / inventory #9). Spreadsheets are read with code (synonyms →
 * at most ONE AI call to map the columns); PDF and photos go page by page
 * through the shared document reader with {@link MEMBER_ROSTER_SCHEMA}.
 */

/** Data rows read from one spreadsheet (it used to be 200 members per load). */
export const MEMBER_MAX_SHEET_ROWS = 5000;
/** Members per `analyze` request; the web sends bigger loads in chunks. */
export const MEMBER_ANALYZE_CHUNK = 200;

export const MEMBER_SHEET_FIELDS = [
  'full_name',
  'first_name',
  'last_name',
  'document_type',
  'document_number',
  'email',
  'phone',
  'date_of_birth',
  'gender',
  'emergency_contact_name',
  'emergency_contact_phone',
  'medical_notes',
  'goals',
  'height_cm',
  'weight_kg',
  'plan_name',
  'plan_price',
  'plan_duration',
  'membership_start_date',
  'membership_end_date',
] as const;
export type MemberSheetField = (typeof MEMBER_SHEET_FIELDS)[number];

export const MEMBER_FIELD_DESCRIPTIONS: Record<MemberSheetField, string> = {
  full_name: 'whole name of the member in one cell (names and surnames)',
  first_name: 'given names only',
  last_name: 'surnames only',
  document_type: 'type of ID document (CC, CE, TI, PA, NIT…)',
  document_number: 'ID document number',
  email: 'e-mail',
  phone: 'phone / mobile / WhatsApp of the member',
  date_of_birth: 'date of birth',
  gender: 'gender / sex',
  emergency_contact_name: 'name of the emergency contact',
  emergency_contact_phone: 'phone of the emergency contact',
  medical_notes: 'medical notes, conditions, injuries, allergies',
  goals: 'training goals',
  height_cm: 'height',
  weight_kg: 'weight',
  plan_name: 'membership plan / package name',
  plan_price: 'price paid or plan price',
  plan_duration: 'plan period (monthly, quarterly, days…)',
  membership_start_date: 'membership start / enrollment date',
  membership_end_date: 'membership end / expiry date',
};

const MEMBER_COLUMN_SYNONYMS: Record<MemberSheetField, string[]> = {
  full_name: [
    'nombre', 'nombre completo', 'nombres y apellidos', 'nombre y apellido',
    'apellidos y nombres', 'socio', 'miembro', 'afiliado', 'cliente', 'usuario',
    'nombre del socio', 'nombre socio', 'nombre del cliente', 'name', 'full name',
  ],
  first_name: ['nombres', 'primer nombre', 'nombre s', 'first name'],
  last_name: ['apellidos', 'apellido', 'primer apellido', 'last name'],
  document_type: [
    'tipo documento', 'tipo de documento', 'tipo doc', 'tipo id', 'tipo identificacion',
    'tipo de identificacion',
  ],
  document_number: [
    'documento', 'cedula', 'cc', 'identificacion', 'numero de documento',
    'numero documento', 'no documento', 'nro documento', 'num documento', 'doc',
    'id', 'dni', 'nuip', 'ident', 'documento de identidad', 'cedula de ciudadania',
  ],
  email: ['correo', 'email', 'e mail', 'correo electronico', 'mail'],
  phone: [
    'telefono', 'celular', 'cel', 'movil', 'whatsapp', 'tel', 'telf', 'tlf',
    'numero de contacto', 'telefono celular',
  ],
  date_of_birth: [
    'fecha de nacimiento', 'fecha nacimiento', 'nacimiento', 'f nacimiento',
    'cumpleanos', 'fecha nac',
  ],
  gender: ['genero', 'sexo'],
  emergency_contact_name: [
    'contacto de emergencia', 'contacto emergencia', 'nombre contacto emergencia',
    'nombre contacto de emergencia', 'acudiente', 'en caso de emergencia',
  ],
  emergency_contact_phone: [
    'telefono de emergencia', 'telefono emergencia', 'tel emergencia',
    'celular emergencia', 'celular de emergencia', 'telefono contacto emergencia',
    'telefono contacto de emergencia', 'celular contacto de emergencia',
    'telefono acudiente',
  ],
  medical_notes: [
    'observaciones medicas', 'notas medicas', 'condiciones medicas',
    'condicion medica', 'enfermedades', 'alergias', 'lesiones', 'salud',
  ],
  goals: ['objetivo', 'objetivos', 'meta', 'metas'],
  height_cm: ['estatura', 'altura', 'talla', 'estatura cm', 'altura cm'],
  weight_kg: ['peso', 'peso kg'],
  plan_name: [
    'plan', 'membresia', 'tipo de plan', 'tipo plan', 'tipo de membresia',
    'tipo membresia', 'paquete', 'plan contratado', 'modalidad', 'nombre del plan',
  ],
  plan_price: [
    'valor', 'precio', 'valor plan', 'precio plan', 'tarifa', 'mensualidad',
    'valor pagado', 'monto', 'valor membresia', 'pago',
  ],
  plan_duration: [
    'duracion', 'periodo', 'periodicidad', 'vigencia', 'dias', 'duracion dias',
    'frecuencia de pago',
  ],
  membership_start_date: [
    'fecha inicio', 'fecha de inicio', 'inicio', 'desde', 'fecha ingreso',
    'fecha de ingreso', 'ingreso', 'fecha afiliacion', 'fecha de afiliacion',
    'inscripcion', 'fecha inscripcion', 'fecha de inscripcion', 'fecha de pago',
    'fecha pago', 'inicio membresia',
  ],
  membership_end_date: [
    'fecha fin', 'fecha de fin', 'fin', 'fecha de vencimiento', 'fecha vencimiento',
    'vencimiento', 'vence', 'hasta', 'fecha final', 'fecha corte', 'fecha de corte',
    'fin membresia',
  ],
};

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };

/**
 * Answer for ONE batch of PDF pages / photo strips. Lenient for ajv (only
 * `members` required); the provider gets its strict form when the AI config
 * opts in to structured output.
 */
export const MEMBER_ROSTER_SCHEMA: ExtractionSchema = {
  name: 'member_roster',
  schema: {
    type: 'object',
    required: ['members'],
    properties: {
      document_type: nullableString,
      detected_plans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: nullableString,
            price: nullableNumber,
            currency: nullableString,
            duration_days: nullableNumber,
            raw_period_label: nullableString,
          },
        },
      },
      members: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            first_name: nullableString,
            last_name: nullableString,
            document_type: nullableString,
            document_number: nullableString,
            email: nullableString,
            phone: nullableString,
            date_of_birth: nullableString,
            gender: nullableString,
            emergency_contact_name: nullableString,
            emergency_contact_phone: nullableString,
            medical_notes: nullableString,
            goals: nullableString,
            height_cm: nullableNumber,
            weight_kg: nullableNumber,
            plan_name: nullableString,
            membership_start_date: nullableString,
            membership_end_date: nullableString,
            raw_row: nullableString,
          },
        },
      },
      warnings: { type: 'array', items: { type: 'string' } },
      confidence: nullableNumber,
    },
  },
};

/** A sheet row as a member, with its plan columns kept for `detected_plans`. */
export interface MemberRowRecord {
  member: ExtractedMember;
  plan_price: number | null;
  plan_duration_days: number | null;
  plan_period_label: string | null;
}

// ─── Value normalizers ─────────────────────────────────────────────────────

function clean(value: string | undefined | null): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v ? v : null;
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "Juan Carlos Pérez Gómez" → Juan Carlos / Pérez Gómez; "Pérez Gómez, Juan"
 * → Juan / Pérez Gómez. Colombian convention: two surnames at the end.
 */
export function splitFullName(full: string): { first: string | null; last: string | null } {
  const value = clean(full);
  if (!value) return { first: null, last: null };
  const comma = value.indexOf(',');
  if (comma > 0) {
    return { first: clean(value.slice(comma + 1)), last: clean(value.slice(0, comma)) };
  }
  const words = value.split(' ');
  if (words.length === 1) return { first: words[0], last: null };
  if (words.length === 2) return { first: words[0], last: words[1] };
  if (words.length === 3) return { first: words[0], last: words.slice(1).join(' ') };
  return { first: words.slice(0, words.length - 2).join(' '), last: words.slice(-2).join(' ') };
}

const DOCUMENT_TYPE_WORDS: Array<[RegExp, string]> = [
  [/^(cc|c c|cedula|cedula de ciudadania|ciudadania)$/, 'CC'],
  [/^(ce|c e|cedula de extranjeria|extranjeria)$/, 'CE'],
  [/^(ti|t i|tarjeta de identidad|tarjeta identidad)$/, 'TI'],
  [/^(pa|pasaporte|pas)$/, 'PA'],
  [/^(nit)$/, 'NIT'],
  [/^(rc|registro civil)$/, 'RC'],
  [/^(pep|permiso especial)$/, 'PEP'],
  [/^(ppt|permiso por proteccion temporal)$/, 'PPT'],
];

export function normalizeDocumentType(value: string | null): string | null {
  const v = clean(value);
  if (!v) return null;
  const key = fold(v);
  for (const [pattern, type] of DOCUMENT_TYPE_WORDS) {
    if (pattern.test(key)) return type;
  }
  return null;
}

/** "C.C. 1.020.304.050" → { type: 'CC', number: '1020304050' }. */
export function splitDocument(
  value: string | null,
): { type: string | null; number: string | null } {
  const v = clean(value);
  if (!v) return { type: null, number: null };
  const digitsOnly = (s: string) => s.replace(/[^0-9A-Za-z]/g, '') || null;
  // "Pasaporte AB123456", "Cédula de extranjería 123": leading words that
  // name a document type, then the number.
  const words = v.split(/[\s:]+/);
  for (let k = Math.min(4, words.length - 1); k >= 1; k -= 1) {
    const type = normalizeDocumentType(words.slice(0, k).join(' '));
    if (type) return { type, number: digitsOnly(words.slice(k).join('')) };
  }
  // "CC1020304050", "C.C.1.020.304": initials glued to the digits.
  const glued = /^([A-Za-z][A-Za-z.]{0,5}?)\.?\s*([0-9][0-9.\s-]*)$/.exec(v);
  if (glued) {
    const type = normalizeDocumentType(glued[1]);
    if (type) return { type, number: digitsOnly(glued[2]) };
  }
  return { type: null, number: digitsOnly(v) };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizePhone(value: string | null): string | null {
  const v = clean(value);
  if (!v) return null;
  const plus = v.startsWith('+');
  const digits = v.replace(/\D/g, '');
  return digits ? `${plus ? '+' : ''}${digits}` : null;
}

/** "$ 120.000" / "120,000.50" / "95000" → number; null when it is not a number. */
export function parseMoney(value: string | null): number | null {
  const v = clean(value);
  if (!v) return null;
  let s = v.replace(/[^0-9.,-]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // The last separator is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0 && /\.\d{3}(\.|$)/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseNumber(value: string | null): number | null {
  const v = clean(value);
  if (!v) return null;
  const n = Number(v.replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const PERIOD_DAYS: Array<[RegExp, number]> = [
  [/\b(diari[oa]|dia)\b/, 1],
  [/\bsemanal\b/, 7],
  [/\bquincenal\b/, 15],
  [/\bmensual(idad)?\b|\bmes\b/, 30],
  [/\bbimestral\b/, 60],
  [/\btrimestral\b/, 90],
  [/\bsemestral\b/, 180],
  [/\banual\b|\bano\b/, 365],
];

/** "Mensual" → 30, "90" / "90 días" → 90, "3 meses" → 90. */
export function parsePeriodDays(value: string | null): number | null {
  const v = clean(value);
  if (!v) return null;
  const key = fold(v);
  const months = /^(\d{1,2}) ?(mes|meses)$/.exec(key);
  if (months) return Number(months[1]) * 30;
  const days = /^(\d{1,4}) ?(d|dia|dias)?$/.exec(key);
  if (days) return Number(days[1]) > 0 ? Number(days[1]) : null;
  for (const [pattern, n] of PERIOD_DAYS) if (pattern.test(key)) return n;
  return null;
}

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, sept: 9, septiembre: 9, set: 9, setiembre: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year > 0) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return null;
  }
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

/**
 * A sheet date as `YYYY-MM-DD` (day first, as in Colombia). Without a year
 * ("4 de julio", "04/07") the year is `0000`: `analyze` puts the store's
 * current year and warns, as for scanned rosters. Excel serial numbers too.
 */
export function parseSheetDate(
  value: string | null,
  options: { past?: boolean } = {},
): string | null {
  const v = clean(value);
  if (!v) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(v);
  if (m) {
    let y = Number(m[3]);
    if (m[3].length === 2) {
      y += 2000;
      // A birth date is in the past: "15/03/85" is 1985, not 2085.
      if (options.past && y > new Date().getUTCFullYear()) y -= 100;
    }
    return isoDate(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (m) return isoDate(0, Number(m[2]), Number(m[1]));
  if (/^\d{5}$/.test(v)) {
    // Excel serial (days since 1899-12-30).
    const serial = Number(v);
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  const words = fold(v);
  m = /^(\d{1,2}) (?:de )?([a-z]+)(?: (?:de |del )?(\d{4}))?$/.exec(words);
  if (m && MONTHS[m[2]]) {
    return isoDate(m[3] ? Number(m[3]) : 0, MONTHS[m[2]], Number(m[1]));
  }
  return null;
}

/** Same vocabulary the roster OCR prompt uses: masculino | femenino | otro. */
export function normalizeGender(value: string | null): string | null {
  const v = clean(value);
  if (!v) return null;
  const key = fold(v);
  if (/^(m|h|masculino|hombre|male|man|varon)$/.test(key)) return 'masculino';
  if (/^(f|femenino|mujer|female|woman)$/.test(key)) return 'femenino';
  if (/^(o|otro|otra|other|no binario|nb)$/.test(key)) return 'otro';
  return null;
}

/** Height in cm; "1.75" / "1,75" (meters) → 175. */
function parseHeightCm(value: string | null): number | null {
  const n = parseNumber(value);
  if (n == null) return null;
  const cm = n < 3 ? Math.round(n * 100) : Math.round(n);
  return cm >= 50 && cm <= 250 ? cm : null;
}

function parseWeightKg(value: string | null): number | null {
  const n = parseNumber(value);
  if (n == null || n < 2 || n > 400) return null;
  return Math.round(n * 100) / 100;
}

// ─── Row normalization ─────────────────────────────────────────────────────

export function normalizeMemberRow(
  raw: Partial<Record<MemberSheetField, string>>,
  ctx: IngestRowContext,
): { record?: MemberRowRecord; issues: IngestRowIssue[]; skipMessage?: string } {
  const issues: IngestRowIssue[] = [];
  const issue = (field: MemberSheetField, message: string) =>
    issues.push({ row: ctx.row, ...(ctx.sheet ? { sheet: ctx.sheet } : {}), level: 'warning', field, message });

  let first = clean(raw.first_name);
  let last = clean(raw.last_name);
  if (raw.full_name && (!first || !last)) {
    const split = splitFullName(raw.full_name);
    first = first ?? split.first;
    last = last ?? split.last;
  }

  const doc = splitDocument(raw.document_number ?? null);
  const declaredType = clean(raw.document_type);
  const documentType = normalizeDocumentType(declaredType) ?? doc.type;
  if (declaredType && !normalizeDocumentType(declaredType)) {
    issue('document_type', `Tipo de documento "${declaredType}" no reconocido; elígelo en la vista previa.`);
  }

  if (!first && !last && !doc.number) {
    return { issues, skipMessage: 'Fila sin nombre ni documento.' };
  }

  let email = clean(raw.email)?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) {
    issue('email', `Correo "${email}" no válido; se dejó vacío.`);
    email = null;
  }

  const dates: Record<'date_of_birth' | 'membership_start_date' | 'membership_end_date', string | null> = {
    date_of_birth: null,
    membership_start_date: null,
    membership_end_date: null,
  };
  for (const field of ['date_of_birth', 'membership_start_date', 'membership_end_date'] as const) {
    const value = clean(raw[field]);
    if (!value) continue;
    const parsed = parseSheetDate(value, { past: field === 'date_of_birth' });
    if (!parsed) issue(field, `Fecha "${value}" no reconocida; se dejó vacía.`);
    // A birth date needs its year (the profile stores a real date).
    else if (field === 'date_of_birth' && parsed.startsWith('0000')) {
      issue(field, `Fecha de nacimiento "${value}" sin año; se dejó vacía.`);
    } else dates[field] = parsed;
  }

  if (raw.gender && !normalizeGender(raw.gender)) {
    issue('gender', `Género "${raw.gender}" no reconocido; se dejó vacío.`);
  }
  const height = raw.height_cm ? parseHeightCm(raw.height_cm) : null;
  if (raw.height_cm && height == null) issue('height_cm', `Estatura "${raw.height_cm}" no reconocida.`);
  const weight = raw.weight_kg ? parseWeightKg(raw.weight_kg) : null;
  if (raw.weight_kg && weight == null) issue('weight_kg', `Peso "${raw.weight_kg}" no reconocido.`);

  const values = MEMBER_SHEET_FIELDS.map((f) => clean(raw[f])).filter(Boolean);
  const member: ExtractedMember = {
    first_name: first,
    last_name: last,
    document_type: documentType,
    document_number: doc.number,
    email,
    phone: normalizePhone(raw.phone ?? null),
    date_of_birth: dates.date_of_birth,
    gender: normalizeGender(raw.gender ?? null),
    emergency_contact_name: clean(raw.emergency_contact_name),
    emergency_contact_phone: normalizePhone(raw.emergency_contact_phone ?? null),
    medical_notes: clean(raw.medical_notes),
    goals: clean(raw.goals),
    height_cm: height,
    weight_kg: weight,
    plan_name: clean(raw.plan_name),
    membership_start_date: dates.membership_start_date,
    membership_end_date: dates.membership_end_date,
    raw_row: values.join(' | ').slice(0, 300) || null,
    source_row: ctx.row,
    ...(ctx.sheet ? { source_sheet: ctx.sheet } : {}),
  };
  return {
    record: {
      member,
      plan_price: parseMoney(raw.plan_price ?? null),
      plan_duration_days: parsePeriodDays(raw.plan_duration ?? null),
      plan_period_label: clean(raw.plan_duration),
    },
    issues,
  };
}

/**
 * Distinct plans of the sheet, by accent/case-insensitive name: first
 * spelling, first price and first period seen. Members keep their
 * `plan_name`; `analyze` links them to these plans as for scanned rosters.
 */
export function detectSheetPlans(records: MemberRowRecord[]): ExtractedPlan[] {
  const plans = new Map<string, ExtractedPlan>();
  for (const r of records) {
    const name = r.member.plan_name;
    if (!name) continue;
    const key = fold(name);
    const plan = plans.get(key);
    if (!plan) {
      plans.set(key, {
        name,
        price: r.plan_price,
        currency: null,
        duration_days: r.plan_duration_days,
        raw_period_label: r.plan_period_label,
      });
      continue;
    }
    if (plan.price == null && r.plan_price != null) plan.price = r.plan_price;
    if (plan.duration_days == null && r.plan_duration_days != null) {
      plan.duration_days = r.plan_duration_days;
      plan.raw_period_label = r.plan_period_label;
    }
  }
  return [...plans.values()];
}

/**
 * Exact repeats (same document or name, same plan and same dates) are the
 * same membership typed twice; the second one is skipped. Two different
 * plans for one person are two memberships and both stay.
 */
export function memberDedupeKey(m: ExtractedMember): string | null {
  const who = m.document_number
    ? `doc:${m.document_number.toLowerCase()}`
    : fold(`${m.first_name ?? ''} ${m.last_name ?? ''}`);
  if (!who) return null;
  return [who, fold(m.plan_name ?? ''), m.membership_start_date ?? '', m.membership_end_date ?? ''].join('|');
}

export const membersIngestProfile: IngestProfile<MemberRowRecord, MemberSheetField> = {
  key: 'members',
  appKey: 'member_roster_ocr',
  recordSchema: MEMBER_ROSTER_SCHEMA,
  columnSynonyms: MEMBER_COLUMN_SYNONYMS,
  requiredFields: [['full_name', 'first_name', 'last_name', 'document_number']],
  // A sheet with only the document (or only the name) recognized and some
  // column with data left over is worth ONE mapping call ("Afil.", "Ident.").
  wantedFields: [['document_number'], ['full_name', 'first_name', 'last_name']],
  normalizeRow: (raw, ctx) => {
    const { record, issues } = normalizeMemberRow(raw, ctx);
    return { record, issues };
  },
  dedupeKey: (r) => memberDedupeKey(r.member),
  limits: {
    maxRows: MEMBER_MAX_SHEET_ROWS,
    maxPages: 10,
    rowsPerBatch: 50,
    pagesPerBatch: 2,
    maxBytes: { sheet: 5 * 1024 * 1024, pdf: 10 * 1024 * 1024, image: 10 * 1024 * 1024 },
  },
  mode: 'list',
};
