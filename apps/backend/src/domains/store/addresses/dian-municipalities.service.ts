import { Injectable } from '@nestjs/common';

import {
  DIAN_DEPARTMENTS,
  DianDepartmentCode,
  DianMunicipality,
  findDianMunicipality,
  findDianMunicipalityByName,
  listDianMunicipalities,
} from '../invoicing/providers/dian-direct/constants/dian-geography';

/**
 * Fila que viaja al frontend. Es un subconjunto plano de {@link DianMunicipality}
 * con `department_name` incluido, precisamente para que el selector NO tenga que
 * mantener su propia tabla de departamentos: el municipio ya trae su
 * departamento, así que una combinación imposible (Medellín / Cundinamarca) es
 * inexpresable en la UI.
 */
export interface DianMunicipalityOption {
  /** Código DANE de 5 dígitos → `addresses.municipality_code`. */
  code: string;
  /** Nombre verbatim de la lista DIAN. */
  name: string;
  /** Los 2 primeros dígitos de `code`. */
  department_code: string;
  /** Nombre oficial del departamento. */
  department_name: string;
  /** Código postal urbano de referencia. */
  postal_code: string;
}

/** Resultado paginado de una búsqueda sobre el catálogo. */
export interface DianMunicipalitySearchResult {
  items: DianMunicipalityOption[];
  /** Municipios que cumplen el filtro, no solo los devueltos en esta página. */
  total: number;
  /** `true` cuando el catálogo tiene coincidencias que esta página no trajo. */
  hasMore: boolean;
}

/** Tope duro: ninguna petición puede pedir el catálogo entero de un tirón. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * Normaliza para comparar: sin tildes, sin puntuación, minúsculas.
 * `Bogotá, D.C.`, `BOGOTA DC` y `bogota d c` colapsan al mismo texto.
 *
 * Es un gemelo del helper privado de `dian-geography.ts` (que no se exporta).
 * Se replica el normalizador —seis líneas— y NUNCA el catálogo.
 */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Búsqueda de solo lectura sobre el catálogo Divipola que la DIAN valida.
 *
 * El catálogo vive en
 * `invoicing/providers/dian-direct/constants/dian-geography.ts` (1122
 * municipios verificados contra `Municipio-2.1.gc`). Este servicio NO lo
 * duplica: lo importa y lo indexa una sola vez en memoria para poder buscarlo
 * por texto.
 *
 * Existe porque el `municipality_code` del adquiriente es un bloqueante de
 * emisión (`CITY_CODE_REQUIRED`) y hasta ahora no había ninguna pantalla donde
 * capturarlo: el catálogo estaba en el repo sin un solo importador.
 */
@Injectable()
export class DianMunicipalitiesService {
  /** Índice de búsqueda, construido perezosamente en el primer acceso. */
  private search_index:
    | ReadonlyArray<{ option: DianMunicipalityOption; haystack: string }>
    | null = null;

  /**
   * Índice `nombre-normalizado-de-departamento → código`. Permite resolver un
   * departamento por nombre (lo que devuelve un geocodificador) y no solo por
   * código.
   */
  private department_index: ReadonlyMap<string, string> | null = null;

  /**
   * Municipios agrupados por departamento, con el nombre ya normalizado.
   * Soporta el desempate por prefijo de {@link resolveByName}.
   */
  private department_municipalities: ReadonlyMap<
    string,
    ReadonlyArray<{ option: DianMunicipalityOption; normalized_name: string }>
  > | null = null;

  /**
   * Busca municipios por código DANE o por nombre (del municipio o de su
   * departamento).
   *
   * - Sin término: devuelve la primera página del catálogo ordenado por código.
   * - Con término: prioriza los que EMPIEZAN por el término sobre los que solo
   *   lo contienen, para que teclear `medel` ponga «Medellín» primero.
   */
  search(term: string | undefined, limit?: number): DianMunicipalitySearchResult {
    const index = this.buildSearchIndex();
    const page_size = this.resolveLimit(limit);
    const needle = normalize(term ?? '');

    if (!needle) {
      return {
        items: index.slice(0, page_size).map((row) => row.option),
        total: index.length,
        hasMore: index.length > page_size,
      };
    }

    const starts_with: DianMunicipalityOption[] = [];
    const contains: DianMunicipalityOption[] = [];

    for (const row of index) {
      const at = row.haystack.indexOf(needle);
      if (at < 0) continue;
      // `haystack` empieza por el código, luego por el nombre; un match en la
      // posición 0 es un prefijo de código, y uno tras un espacio es un prefijo
      // de palabra.
      if (at === 0 || row.haystack[at - 1] === ' ') starts_with.push(row.option);
      else contains.push(row.option);
    }

    const matches = [...starts_with, ...contains];
    return {
      items: matches.slice(0, page_size),
      total: matches.length,
      hasMore: matches.length > page_size,
    };
  }

  /** Municipio exacto por código DANE, o `null` si no está en la lista DIAN. */
  findByCode(code: string | null | undefined): DianMunicipalityOption | null {
    const municipality = findDianMunicipality(code);
    return municipality ? this.toOption(municipality) : null;
  }

  /** `true` si el código pertenece al catálogo que la DIAN acepta. */
  isValidCode(code: string | null | undefined): boolean {
    return findDianMunicipality(code) !== null;
  }

  /**
   * Resuelve el municipio a partir de los textos que deja un geocodificador
   * (`city` + `department`), porque Nominatim devuelve nombres y nunca el
   * código DANE (ver `geocoding.service.ts:440`).
   *
   * El departamento se acepta como código de 2 dígitos O como nombre. Se exige
   * porque hay nombres de municipio repetidos entre departamentos: resolver
   * solo por nombre elegiría uno arbitrario, que es exactamente el defecto que
   * el catálogo existe para evitar.
   *
   * Devuelve `null` cuando no logra resolverlo — y ese `null` es la respuesta
   * útil: significa «pídeselo al operador», nunca «rellena Bogotá».
   */
  resolveByName(
    city: string | null | undefined,
    department: string | null | undefined,
  ): DianMunicipalityOption | null {
    if (!city || !department) return null;

    const department_code = this.resolveDepartmentCode(department);
    if (!department_code) return null;

    // 1) Coincidencia exacta de nombre dentro del departamento.
    const exact = findDianMunicipalityByName(city, department_code);
    if (exact) return this.toOption(exact);

    // 2) Coincidencia por prefijo dentro del MISMO departamento, y solo si es
    //    ÚNICA. Existe por un caso muy concreto y muy frecuente: el catálogo
    //    escribe la capital como «Bogotá, D.c.» y cualquier geocodificador dice
    //    «Bogotá», así que la coincidencia exacta falla justo en el municipio
    //    más común del país.
    //
    //    Si hay más de un candidato NO se elige ninguno: adivinar entre varios
    //    municipios es exactamente el defecto que este catálogo existe para
    //    evitar. Ambigüedad → `null` → que lo elija el operador.
    const needle = normalize(city);
    if (!needle) return null;

    const candidates = this.buildDepartmentMunicipalityIndex()
      .get(department_code)
      ?.filter((entry) => {
        const name = entry.normalized_name;
        return name.startsWith(needle) || needle.startsWith(name);
      });

    if (!candidates || candidates.length !== 1) return null;
    return candidates[0].option;
  }

  /** Los 33 departamentos, ordenados por código. */
  listDepartments(): ReadonlyArray<{ code: string; name: string }> {
    return Object.entries(DIAN_DEPARTMENTS)
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  // ── internos ────────────────────────────────────────────────────────────

  private resolveLimit(limit?: number): number {
    if (limit == null || Number.isNaN(limit) || limit <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.trunc(limit), MAX_LIMIT);
  }

  private toOption(municipality: DianMunicipality): DianMunicipalityOption {
    return {
      code: municipality.code,
      name: municipality.name,
      department_code: municipality.department_code,
      department_name: municipality.department_name,
      postal_code: municipality.postal_code,
    };
  }

  /**
   * Acepta `'05'` o `'Antioquia'` (con o sin tildes) y devuelve el código de 2
   * dígitos, o `null` si no es un departamento del catálogo.
   */
  private resolveDepartmentCode(department: string): string | null {
    const raw = department.trim();
    if (
      /^\d{2}$/.test(raw) &&
      Object.prototype.hasOwnProperty.call(DIAN_DEPARTMENTS, raw)
    ) {
      return raw;
    }
    return this.buildDepartmentIndex().get(normalize(raw)) ?? null;
  }

  private buildDepartmentIndex(): ReadonlyMap<string, string> {
    if (this.department_index) return this.department_index;
    const index = new Map<string, string>();
    for (const [code, name] of Object.entries(DIAN_DEPARTMENTS)) {
      index.set(normalize(name), code);
    }
    // Alias que devuelven los geocodificadores para Bogotá, cuyo nombre oficial
    // en la lista DIAN es solo «Bogotá».
    const bogota = DIAN_DEPARTMENTS['11' as DianDepartmentCode];
    if (bogota) {
      index.set('bogota d c', '11');
      index.set('bogota dc', '11');
      index.set('distrito capital de bogota', '11');
    }
    this.department_index = index;
    return index;
  }

  private buildDepartmentMunicipalityIndex(): ReadonlyMap<
    string,
    ReadonlyArray<{ option: DianMunicipalityOption; normalized_name: string }>
  > {
    if (this.department_municipalities) return this.department_municipalities;
    const index = new Map<
      string,
      Array<{ option: DianMunicipalityOption; normalized_name: string }>
    >();
    for (const municipality of listDianMunicipalities()) {
      const option = this.toOption(municipality);
      const bucket = index.get(option.department_code) ?? [];
      bucket.push({ option, normalized_name: normalize(option.name) });
      index.set(option.department_code, bucket);
    }
    this.department_municipalities = index;
    return index;
  }

  private buildSearchIndex(): ReadonlyArray<{
    option: DianMunicipalityOption;
    haystack: string;
  }> {
    if (this.search_index) return this.search_index;
    this.search_index = listDianMunicipalities().map((municipality) => {
      const option = this.toOption(municipality);
      return {
        option,
        // `código nombre departamento` — un solo string por fila, así una
        // búsqueda es un `indexOf` y no tres.
        haystack: `${option.code} ${normalize(option.name)} ${normalize(
          option.department_name,
        )}`,
      };
    });
    return this.search_index;
  }
}
