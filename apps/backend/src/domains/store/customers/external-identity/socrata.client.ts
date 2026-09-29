import { Injectable, Logger } from '@nestjs/common';

const SOCRATA_BASE_URL = 'https://www.datos.gov.co/resource';
const MAX_5XX_RETRIES = 2;

export interface SocrataQuery {
  where: string;
  select: string;
  limit: number;
  order?: string;
}

/**
 * Cliente delgado de Socrata (datos.gov.co). Nunca lanza: devuelve `null` si la
 * fuente falla (red, abort, HTTP no OK, cuerpo ilegible). El llamador es dueño
 * del AbortController y del presupuesto de tiempo.
 */
@Injectable()
export class SocrataClient {
  private readonly logger = new Logger(SocrataClient.name);

  async fetchRows(
    datasetId: string,
    q: SocrataQuery,
    signal: AbortSignal,
  ): Promise<unknown[] | null> {
    let url =
      `${SOCRATA_BASE_URL}/${datasetId}.json` +
      `?$select=${encodeURIComponent(q.select)}` +
      `&$where=${encodeURIComponent(q.where)}` +
      `&$limit=${q.limit}`;
    if (q.order) url += `&$order=${encodeURIComponent(q.order)}`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    const appToken = process.env.SOCRATA_APP_TOKEN;
    if (appToken) headers['X-App-Token'] = appToken;

    try {
      // Socrata alterna 500/503 transitorios con 200 para la misma URL.
      let res = await fetch(url, { headers, signal });
      for (let retry = 0; retry < MAX_5XX_RETRIES && res.status >= 500; retry++) {
        res = await fetch(url, { headers, signal });
      }
      if (!res.ok) {
        this.logger.warn(`${datasetId} respondió HTTP ${res.status}`);
        return null;
      }
      const body: unknown = await res.json();
      if (!Array.isArray(body)) {
        this.logger.warn(`${datasetId} devolvió un cuerpo inesperado`);
        return null;
      }
      return body;
    } catch (err) {
      this.logger.warn(`Consulta ${datasetId} falló: ${err}`);
      return null;
    }
  }
}
