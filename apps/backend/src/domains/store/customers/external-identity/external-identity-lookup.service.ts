import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { normalizeNit, onlyDigits } from '@common/utils/nit.util';
import {
  ExternalIdentity,
  ExternalIdentitySource,
  ExternalLookupResult,
  SourceOutcome,
} from './external-identity.types';
import { RuesSource } from './rues.source';
import { SecopProveedoresSource } from './secop-proveedores.source';
import { SecopContratosSource } from './secop-contratos.source';
import { RntSource } from './rnt.source';

const FETCH_TIMEOUT_MS = 5_000;
const MIN_DIGITS = 5;
const CACHE_TTL_FOUND_S = 86_400;
const CACHE_TTL_NOT_FOUND_S = 21_600;

/**
 * Orquestador de la búsqueda en vivo en fuentes públicas (datos.gov.co).
 * Consulta las 4 fuentes en paralelo bajo un único presupuesto de 5 s y elige
 * por prioridad: RUES > SECOP II Proveedores > SECOP Integrado > RNT.
 * Nunca lanza; una caída no se cachea como «no existe».
 */
@Injectable()
export class ExternalIdentityLookupService {
  private readonly logger = new Logger(ExternalIdentityLookupService.name);
  /** Orden = prioridad. */
  private readonly sources: ExternalIdentitySource[];

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    rues: RuesSource,
    secopProveedores: SecopProveedoresSource,
    secopContratos: SecopContratosSource,
    rnt: RntSource,
  ) {
    this.sources = [rues, secopProveedores, secopContratos, rnt];
  }

  async lookup(rawDocument: string): Promise<ExternalLookupResult> {
    const doc = this.canonicalize(rawDocument);
    if (doc.length < MIN_DIGITS) return { found: false };

    const cacheKey = `ext-identity:lookup:${doc}`;
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let outcomes: Array<SourceOutcome | undefined>;
    try {
      outcomes = await this.runWithEarlyResolution(doc, controller);
    } finally {
      clearTimeout(timer);
    }

    const identity = outcomes.find(
      (o): o is ExternalIdentity =>
        o !== undefined && o !== null && o !== 'unavailable',
    );
    if (identity) {
      const result: ExternalLookupResult = { found: true, identity };
      await this.writeCache(cacheKey, result, CACHE_TTL_FOUND_S);
      return result;
    }
    if (outcomes.includes('unavailable')) {
      return { found: false, unavailable: true };
    }
    const result: ExternalLookupResult = { found: false };
    await this.writeCache(cacheKey, result, CACHE_TTL_NOT_FOUND_S);
    return result;
  }

  /**
   * Lanza todas las fuentes en paralelo y resuelve en cuanto la identidad de
   * mayor prioridad hallada tiene asentadas todas las fuentes de prioridad
   * superior; entonces aborta las restantes. `undefined` = sin asentar.
   */
  private runWithEarlyResolution(
    doc: string,
    controller: AbortController,
  ): Promise<Array<SourceOutcome | undefined>> {
    return new Promise((resolve) => {
      const outcomes: Array<SourceOutcome | undefined> = new Array(
        this.sources.length,
      ).fill(undefined);
      let done = false;

      const evaluate = () => {
        if (done) return;
        for (let i = 0; i < outcomes.length; i++) {
          const o = outcomes[i];
          if (o === undefined) return; // aún se espera una fuente de mayor prioridad
          if (o !== null && o !== 'unavailable') break; // identidad con todo lo previo asentado
          if (i === outcomes.length - 1) break; // todas asentadas sin identidad
        }
        done = true;
        controller.abort();
        resolve(outcomes);
      };

      this.sources.forEach((s, i) => {
        s.lookup(doc, controller.signal)
          .catch((err): SourceOutcome => {
            this.logger.warn(`Fuente ${s.id} lanzó para ${doc}: ${err}`);
            return 'unavailable';
          })
          .then((o) => {
            outcomes[i] = o;
            evaluate();
          });
      });
    });
  }

  private canonicalize(raw: string): string {
    const value = (raw ?? '').trim();
    return value.includes('-') ? normalizeNit(value).number : onlyDigits(value);
  }

  private async readCache(key: string): Promise<ExternalLookupResult | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as ExternalLookupResult;
    } catch (err) {
      this.logger.warn(`Redis read failed for ${key}: ${err}`);
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: ExternalLookupResult,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis write failed for ${key}: ${err}`);
    }
  }
}
