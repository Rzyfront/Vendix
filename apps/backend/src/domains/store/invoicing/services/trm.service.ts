import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DianNumericInput, toDecimal } from '../utils/dian-money.util';

/**
 * TASA REPRESENTATIVA DEL MERCADO (TRM) — la única conversión oficial a pesos.
 *
 * ## Por qué existe, y por qué NO cambia la moneda del documento
 *
 * Leer antes de asumir lo contrario: la factura electrónica colombiana se emite
 * **SIEMPRE en pesos**. `cbc:DocumentCurrencyCode` es COP y los `@currencyID`
 * de todos los importes también (Res. DIAN 000042/2020 art. 73; Oficios DIAN
 * 901544 y 903436 de 2020; Concepto 1509 de 2024). Una operación pactada en
 * dólares NO se factura en dólares: se factura en pesos y se DECLARA la
 * conversión en el grupo `cac:PaymentExchangeRate`.
 *
 * Este servicio resuelve el único número que ese grupo necesita y que el emisor
 * no puede inventar: cuántos pesos vale una unidad de la divisa el día pactado.
 *
 * ## La fuente
 *
 * Dato abierto de la Superintendencia Financiera publicado en datos.gov.co,
 * dataset `32sa-8pi3`. Se publica a diario alrededor de las 5:30 p.m. hora
 * Colombia para regir el día siguiente.
 *
 * ## Por qué se consulta por RANGO y no por `vigenciadesde` exacto
 *
 * Cada fila trae `vigenciadesde` y `vigenciahasta`, y NO son el mismo día: la
 * TRM publicada un viernes rige sábado, domingo y lunes. Filtrar por
 * `?vigenciadesde=<fecha>` —la forma que primero viene a la mano— devuelve `[]`
 * para cualquier fin de semana o festivo, sin error HTTP y sin mensaje: un
 * arreglo vacío indistinguible de «la API se cayó». Se consulta el rango, que
 * es la pregunta que de verdad se quiere hacer («qué TRM rige el día X»).
 *
 * ## Degradación
 *
 * NUNCA tumba la emisión. Si la API no responde, responde lento o responde algo
 * que no se puede leer, devuelve `null` y el llamador decide: usar la tasa
 * manual que el usuario declaró, o rechazar el documento pidiéndosela. Una
 * llamada HTTP a un tercero no puede ser la razón por la que un contribuyente
 * no puede facturar.
 */

/** Endpoint del dato abierto (Socrata). */
const TRM_DATASET_URL = 'https://www.datos.gov.co/resource/32sa-8pi3.json';

/**
 * Corte de la llamada externa. Cinco segundos es mucho para un dato cacheado y
 * poco para bloquear una emisión: pasado ese punto conviene más el camino de
 * degradación (tasa manual) que seguir esperando con el usuario en pantalla.
 */
const TRM_FETCH_TIMEOUT_MS = 5_000;

/** Moneda del documento fiscal colombiano. No es configurable. */
export const DIAN_DOCUMENT_CURRENCY = 'COP';

/** De dónde salió la tasa que se va a declarar. */
export type ExchangeRateSource =
  /** TRM oficial de la Superintendencia Financiera. */
  | 'trm'
  /** Tasa que declaró el usuario en el request. Gana siempre sobre la TRM. */
  | 'manual'
  /** Tasa manual usada porque la TRM no se pudo consultar. */
  | 'manual_fallback';

export interface TrmQuote {
  /** Pesos por 1 USD. */
  value: Prisma.Decimal;
  /** Primer día en que rige, `YYYY-MM-DD`. */
  valid_from: string;
  /** Último día en que rige, `YYYY-MM-DD`. */
  valid_to: string;
}

export interface ResolveExchangeRateParams {
  /** ISO 4217 de la divisa pactada (USD, EUR…). */
  currency: string;
  /** Día de la tasa, `YYYY-MM-DD`. */
  date: string;
  /**
   * Tasa declarada por el usuario, en pesos por UNA unidad de `currency`.
   * Cuando viene, manda: el emisor puede haber pactado una tasa distinta de la
   * TRM del día y es él quien responde por ella ante la DIAN.
   */
  manual_rate?: DianNumericInput;
  /**
   * Sólo para divisas distintas de USD: cuántas unidades de `currency` vale 1
   * USD el día `date`. Con ella la conversión es `TRM / cross_rate`.
   *
   * No se resuelve automáticamente A PROPÓSITO. La TRM es el único tipo de
   * cambio con fuente oficial colombiana; para el resto habría que elegir un
   * proveedor de FX privado, y qué tasa vale ante la DIAN es una decisión del
   * contribuyente, no del software. Sin esta tasa y sin `manual_rate`, una
   * factura en euros no se puede emitir — y eso es preferible a inventarle una
   * cotización.
   */
  usd_cross_rate?: DianNumericInput;
}

export interface ResolvedExchangeRate {
  /** Pesos por 1 unidad de `currency`. Es `cbc:CalculationRate` (FAR06). */
  rate: Prisma.Decimal;
  source: ExchangeRateSource;
  /** Fecha efectiva de la tasa (`cbc:Date`, FAR07). */
  date: string;
  /** TRM consultada, cuando la hubo. Sirve para auditar una tasa manual. */
  trm?: TrmQuote;
}

@Injectable()
export class TrmService {
  private readonly logger = new Logger(TrmService.name);

  /**
   * Caché por día, SIN TTL: la TRM de una fecha ya publicada es inmutable, así
   * que no hay nada que pueda quedar rancio.
   *
   * Sólo se cachean los aciertos. Un fallo no se guarda a propósito — si se
   * cacheara el «no la pude resolver», una caída de treinta segundos de
   * datos.gov.co dejaría a la tienda sin TRM el resto del día.
   */
  private readonly cache = new Map<string, TrmQuote>();

  /**
   * Resuelve la tasa a declarar en `cac:PaymentExchangeRate`.
   *
   * Precedencia: tasa manual > TRM > tasa manual como respaldo. La manual gana
   * porque la conversión pactada en el contrato puede diferir legítimamente de
   * la TRM del día, y quien responde por ella ante la DIAN es el emisor.
   *
   * Devuelve `null` cuando no hay forma de resolverla. NO lanza: el llamador
   * tiene el contexto para decidir si eso bloquea la emisión (documento en
   * divisa) o es irrelevante (documento en pesos).
   */
  async resolveExchangeRate(
    params: ResolveExchangeRateParams,
  ): Promise<ResolvedExchangeRate | null> {
    const currency = (params.currency || '').trim().toUpperCase();

    // Documento en pesos: no hay conversión que declarar. Se responde `null` en
    // vez de una tasa de 1,00 porque la DIAN RECHAZA un
    // `cbc:SourceCurrencyBaseRate` igual a 1,00 (FAR03): declarar la conversión
    // COP→COP es precisamente lo que la regla prohíbe.
    if (!currency || currency === DIAN_DOCUMENT_CURRENCY) {
      return null;
    }

    const manual = this.positiveDecimal(params.manual_rate);
    const trm = await this.getTrm(params.date);

    if (manual) {
      return {
        rate: manual,
        source: trm ? 'manual' : 'manual_fallback',
        date: params.date,
        ...(trm ? { trm } : {}),
      };
    }

    if (!trm) return null;

    if (currency === 'USD') {
      return { rate: trm.value, source: 'trm', date: params.date, trm };
    }

    // Divisa distinta de USD: primero a dólares con la cotización cruzada del
    // día, luego a pesos con la TRM. Sin la cruzada no hay conversión posible y
    // no se adivina.
    const cross = this.positiveDecimal(params.usd_cross_rate);
    if (!cross) return null;

    return {
      rate: trm.value.dividedBy(cross),
      source: 'trm',
      date: params.date,
      trm,
    };
  }

  /**
   * TRM vigente el día `date` (`YYYY-MM-DD`), o `null` si no se pudo resolver.
   *
   * Cachea el acierto para siempre —la TRM de un día pasado no cambia— y NO
   * cachea el fallo, para que una caída momentánea de datos.gov.co no deje al
   * proceso sin TRM durante toda su vida.
   */
  async getTrm(date: string): Promise<TrmQuote | null> {
    if (!this.isIsoDate(date)) {
      this.logger.warn(
        `Fecha de TRM inválida ("${date}"); se esperaba YYYY-MM-DD.`,
      );
      return null;
    }

    const cached = this.cache.get(date);
    if (cached) return cached;

    const quote = await this.fetchTrm(date);
    if (quote) this.cache.set(date, quote);
    return quote;
  }

  /**
   * Inyecta manualmente una TRM en la caché.
   *
   * Existe para el override operativo: una tienda que ya conoce la TRM del día
   * (o que trabaja sin salida a internet) puede sembrarla sin depender de la
   * API. También es el gancho por el que los tests fijan el valor sin tocar la
   * red.
   */
  overrideTrm(quote: TrmQuote): void {
    // Se siembra TODO el rango de vigencia, no sólo `valid_from`: una TRM de
    // viernes rige hasta el lunes, y cachear un solo día dejaría al sábado
    // saliendo a la red por un dato que ya está en memoria.
    for (const day of this.daysInRange(quote.valid_from, quote.valid_to)) {
      this.cache.set(day, quote);
    }
  }

  /** Vacía la caché. Sólo para tests y para un reinicio operativo en caliente. */
  clearCache(): void {
    this.cache.clear();
  }

  // --- Privados ---

  private async fetchTrm(date: string): Promise<TrmQuote | null> {
    // Rango, no igualdad: ver la nota de cabecera. `$limit=1` porque las
    // vigencias no se solapan.
    const where = `vigenciadesde <= '${date}T00:00:00.000' AND vigenciahasta >= '${date}T00:00:00.000'`;
    const url = `${TRM_DATASET_URL}?$where=${encodeURIComponent(where)}&$limit=1`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRM_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        this.logger.warn(
          `TRM ${date}: datos.gov.co respondió ${response.status}. Se continúa sin TRM.`,
        );
        return null;
      }

      const rows: unknown = await response.json();
      return this.parseQuote(rows, date);
    } catch (error) {
      // Incluye el abort por timeout. Se degrada, nunca se propaga: una llamada
      // a un tercero no puede impedir facturar.
      this.logger.warn(
        `TRM ${date}: no se pudo consultar (${
          error instanceof Error ? error.message : String(error)
        }). Se continúa sin TRM.`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Lee la fila del dataset con desconfianza: `valor` llega como string, y una
   * cotización que no se pueda parsear a un número POSITIVO se descarta en vez
   * de convertirse en un cero que multiplicaría todo el documento por nada.
   */
  private parseQuote(rows: unknown, date: string): TrmQuote | null {
    if (!Array.isArray(rows) || rows.length === 0) {
      this.logger.warn(`TRM ${date}: el dataset no devolvió ninguna vigencia.`);
      return null;
    }

    const row = rows[0] as Record<string, unknown>;
    const value = this.positiveDecimal(
      typeof row.valor === 'string' || typeof row.valor === 'number'
        ? row.valor
        : null,
    );

    if (!value) {
      this.logger.warn(
        `TRM ${date}: la fila devuelta no trae un valor utilizable.`,
      );
      return null;
    }

    return {
      value,
      valid_from: this.toIsoDate(row.vigenciadesde) ?? date,
      valid_to: this.toIsoDate(row.vigenciahasta) ?? date,
    };
  }

  /** `Decimal` estrictamente positivo, o `null`. Un 0 o un NaN NO son tasas. */
  private positiveDecimal(value: DianNumericInput): Prisma.Decimal | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = toDecimal(value);
    return parsed.greaterThan(0) ? parsed : null;
  }

  private isIsoDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');
  }

  /** `2026-08-15T00:00:00.000` → `2026-08-15`. */
  private toIsoDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const day = value.slice(0, 10);
    return this.isIsoDate(day) ? day : null;
  }

  /**
   * Días calendario entre dos fechas inclusive. Se acota a 31 iteraciones para
   * que una vigencia corrupta del dataset (un `vigenciahasta` en el año 2999)
   * no se lleve la memoria del proceso.
   */
  private daysInRange(from: string, to: string): string[] {
    const days: string[] = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return [from];
    }

    for (
      let cursor = start;
      cursor <= end && days.length < 31;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      days.push(cursor.toISOString().slice(0, 10));
    }

    return days.length > 0 ? days : [from];
  }
}
