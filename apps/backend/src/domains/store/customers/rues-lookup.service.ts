import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { computeNitDv, normalizeNit, onlyDigits } from '@common/utils/nit.util';

/**
 * CONSULTA EN VIVO AL RUES (Registro Único Empresarial y Social).
 *
 * Proxy delgado al dato abierto publicado en datos.gov.co (Socrata), dataset
 * `c82u-588k`. NO hay réplica local ni se persiste nada: cada consulta sale a la
 * red o se sirve de Redis.
 *
 * Nunca lanza. Si la fuente cae, tarda más de 5 s o responde algo ilegible,
 * devuelve `{ found: false, unavailable: true }` y NO cachea el fallo: una caída
 * momentánea no puede convertirse en «no existe» durante 6 horas.
 *
 * Notas sobre el dato (verificadas contra el dataset real):
 * - Las filas de NIT sólo traen `numero_identificacion` (+ `digito_verificacion`);
 *   las de cédula traen además `nit`/nombres separados. Por eso el `$where`
 *   consulta ambas columnas.
 * - Hay filas sin nombres separados: sólo `razon_social`.
 */
const RUES_DATASET_URL = 'https://www.datos.gov.co/resource/c82u-588k.json';
const RUES_FETCH_TIMEOUT_MS = 5_000;
const RUES_ROW_LIMIT = 20;
const RUES_MAX_5XX_RETRIES = 2;
const RUES_MIN_DIGITS = 5;
const RUES_CACHE_TTL_FOUND_S = 86_400;
const RUES_CACHE_TTL_NOT_FOUND_S = 21_600;

const RUES_SELECT = [
  'codigo_clase_identificacion',
  'clase_identificacion',
  'numero_identificacion',
  'nit',
  'digito_verificacion',
  'razon_social',
  'primer_nombre',
  'segundo_nombre',
  'primer_apellido',
  'segundo_apellido',
  'organizacion_juridica',
  'estado_matricula',
  'ultimo_ano_renovado',
  'camara_comercio',
  'fecha_actualizacion',
].join(',');

export type RuesPersonType = 'NATURAL' | 'JURIDICA';

export interface RuesIdentity {
  source: 'rues';
  document_type: string;
  document_number: string;
  verification_digit: string | null;
  person_type: RuesPersonType;
  legal_name: string | null;
  first_name: string | null;
  last_name: string | null;
  registration_status: string | null;
  is_active: boolean;
  last_renewed_year: number | null;
  chamber: string | null;
  source_updated_at: string | null;
  dv_mismatch?: boolean;
}

export interface RuesLookupResult {
  found: boolean;
  unavailable?: boolean;
  identity?: RuesIdentity;
}

/** Fila cruda de Socrata: todos los campos llegan como texto y pueden faltar. */
interface RuesRow {
  codigo_clase_identificacion?: string;
  clase_identificacion?: string;
  numero_identificacion?: string;
  nit?: string;
  digito_verificacion?: string;
  razon_social?: string;
  primer_nombre?: string;
  segundo_nombre?: string;
  primer_apellido?: string;
  segundo_apellido?: string;
  organizacion_juridica?: string;
  estado_matricula?: string;
  ultimo_ano_renovado?: string;
  camara_comercio?: string;
  fecha_actualizacion?: string;
}

/** Código RUES de clase de identificación → tipo de documento Vendix. */
const RUES_DOCUMENT_TYPES: Record<string, string> = {
  '01': 'CC',
  '02': 'NIT',
  '03': 'CE',
  '04': 'TI',
  '05': 'PA',
};

@Injectable()
export class RuesLookupService {
  private readonly logger = new Logger(RuesLookupService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async lookup(rawDocument: string): Promise<RuesLookupResult> {
    const doc = this.canonicalize(rawDocument);
    if (doc.length < RUES_MIN_DIGITS) return { found: false };

    const cacheKey = `rues:lookup:${doc}`;
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    const rows = await this.fetchRows(doc);
    if (rows === null) return { found: false, unavailable: true };

    const row = this.pickRow(rows);
    const result: RuesLookupResult = row
      ? { found: true, identity: this.toIdentity(row, doc) }
      : { found: false };

    await this.writeCache(
      cacheKey,
      result,
      result.found ? RUES_CACHE_TTL_FOUND_S : RUES_CACHE_TTL_NOT_FOUND_S,
    );
    return result;
  }

  private canonicalize(raw: string): string {
    const value = (raw ?? '').trim();
    return value.includes('-') ? normalizeNit(value).number : onlyDigits(value);
  }

  /** `null` = la fuente falló (red, timeout, HTTP no OK o cuerpo ilegible). */
  private async fetchRows(doc: string): Promise<RuesRow[] | null> {
    const where = `nit='${doc}' OR numero_identificacion='${doc}'`;
    const url =
      `${RUES_DATASET_URL}?$select=${RUES_SELECT}` +
      `&$where=${encodeURIComponent(where)}&$limit=${RUES_ROW_LIMIT}`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    const appToken = process.env.SOCRATA_APP_TOKEN;
    if (appToken) headers['X-App-Token'] = appToken;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RUES_FETCH_TIMEOUT_MS);
    try {
      // Socrata alterna 500/503 transitorios con 200 para la misma URL: se
      // reintenta un 5xx dentro del mismo presupuesto de 5 s (el abort corta
      // cualquier intento que se pase).
      let res = await fetch(url, { headers, signal: controller.signal });
      for (let retry = 0; retry < RUES_MAX_5XX_RETRIES && res.status >= 500; retry++) {
        res = await fetch(url, { headers, signal: controller.signal });
      }
      if (!res.ok) {
        this.logger.warn(`RUES respondió HTTP ${res.status} para ${doc}`);
        return null;
      }
      const body: unknown = await res.json();
      if (!Array.isArray(body)) {
        this.logger.warn(`RUES devolvió un cuerpo inesperado para ${doc}`);
        return null;
      }
      return body as RuesRow[];
    } catch (err) {
      this.logger.warn(`Consulta RUES falló para ${doc}: ${err}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** ACTIVA primero; entre iguales, la `fecha_actualizacion` más reciente. */
  private pickRow(rows: RuesRow[]): RuesRow | null {
    if (rows.length === 0) return null;
    const rank = (r: RuesRow) => (r.estado_matricula === 'ACTIVA' ? 1 : 0);
    // El formato `YYYY/MM/DD HH:mm:ss.SSS…` ordena bien como texto.
    const updated = (r: RuesRow) => r.fecha_actualizacion ?? '';
    return [...rows].sort(
      (a, b) => rank(b) - rank(a) || updated(b).localeCompare(updated(a)),
    )[0];
  }

  private toIdentity(row: RuesRow, doc: string): RuesIdentity {
    const isNit =
      row.codigo_clase_identificacion === '02' ||
      (row.clase_identificacion ?? '').toUpperCase() === 'NIT';
    const legalOrg = (row.organizacion_juridica ?? '').toUpperCase();
    const person_type: RuesPersonType =
      isNit || (legalOrg !== '' && legalOrg !== 'PERSONA NATURAL')
        ? 'JURIDICA'
        : 'NATURAL';

    const document_type = isNit
      ? 'NIT'
      : (RUES_DOCUMENT_TYPES[row.codigo_clase_identificacion ?? ''] ?? 'CC');

    const razon = this.clean(row.razon_social);
    let first_name: string | null = null;
    let last_name: string | null = null;
    let legal_name: string | null = null;

    if (person_type === 'NATURAL') {
      first_name = this.join(row.primer_nombre, row.segundo_nombre);
      last_name = this.join(row.primer_apellido, row.segundo_apellido);
      if (!first_name && !last_name) legal_name = razon;
    } else {
      legal_name = razon;
    }

    let verification_digit: string | null = null;
    let dv_mismatch: boolean | undefined;
    if (isNit) {
      verification_digit = computeNitDv(doc) || null;
      const rueDv = this.clean(row.digito_verificacion);
      if (rueDv && verification_digit && rueDv !== verification_digit) {
        dv_mismatch = true;
      }
    }

    const year = Number.parseInt(row.ultimo_ano_renovado ?? '', 10);
    const status = this.clean(row.estado_matricula);

    return {
      source: 'rues',
      document_type,
      document_number: doc,
      verification_digit,
      person_type,
      legal_name,
      first_name,
      last_name,
      registration_status: status,
      is_active: status === 'ACTIVA',
      last_renewed_year: Number.isFinite(year) && year > 0 ? year : null,
      chamber: this.clean(row.camara_comercio),
      source_updated_at: this.clean(row.fecha_actualizacion),
      ...(dv_mismatch ? { dv_mismatch } : {}),
    };
  }

  private clean(value: string | undefined): string | null {
    const v = (value ?? '').trim();
    return v === '' ? null : v;
  }

  private join(...parts: Array<string | undefined>): string | null {
    const v = parts
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(' ');
    return v === '' ? null : v;
  }

  // --------------------------------------------------------------- Redis
  private async readCache(key: string): Promise<RuesLookupResult | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as RuesLookupResult;
    } catch (err) {
      this.logger.warn(`Redis read failed for ${key}: ${err}`);
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: RuesLookupResult,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis write failed for ${key}: ${err}`);
    }
  }
}
