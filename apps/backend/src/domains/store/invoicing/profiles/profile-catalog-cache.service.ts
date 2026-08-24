import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { REDIS_CLIENT } from '../../../../common/redis/redis.module';

/**
 * Catálogo de perfiles ACTIVOS de una tienda, memorizado en Redis.
 *
 * ## Qué se guarda y por qué tan poco
 *
 * Sólo lo que el selector del wizard necesita para pintar la lista: id, nombre,
 * tipo de operación, marca de predeterminado y número de versión vigente.
 * **Nunca la configuración.** Un `config` en caché es una tarifa fiscal con
 * fecha de caducidad: si alguien edita el perfil y el wizard calcula con la
 * copia rancia, la factura se emite con la tarifa retirada. El `config` se lee
 * siempre de base, en el momento de usarlo.
 *
 * ## Por qué TTL corto además de invalidación explícita
 *
 * La invalidación es best-effort —si Redis no responde, el `del` se pierde—, así
 * que el TTL es lo que acota el daño en el peor caso. 30 segundos y no 60 como
 * `sub:features`: el catálogo cambia por acción directa del usuario, que espera
 * ver el efecto de inmediato, mientras que el estado de suscripción cambia por
 * eventos de cobro que nadie está mirando.
 */
const CACHE_PREFIX = 'inv:profiles:catalog';
const CACHE_TTL_SECONDS = 30;

export interface CatalogEntry {
  id: number;
  name: string;
  operation_type: string;
  is_default: boolean;
  current_version: number;
}

/**
 * El `store_id` entra en la clave, y se valida antes de entrar.
 *
 * Sin la validación, un valor no entero llegaría a la clave por interpolación:
 * `inv:profiles:catalog:undefined` es una clave válida para Redis, y la
 * compartirían todos los tenants a los que les faltara el contexto. Se lanza en
 * vez de degradar a base en silencio, porque un catálogo servido bajo una clave
 * equivocada es una fuga entre tiendas y no un problema de rendimiento.
 */
function assertValidStoreId(store_id: number): asserts store_id is number {
  if (
    !Number.isInteger(store_id) ||
    store_id <= 0 ||
    store_id > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`store_id inválido para la clave de caché: ${store_id}`);
  }
}

@Injectable()
export class ProfileCatalogCacheService {
  private readonly logger = new Logger(ProfileCatalogCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private cacheKey(store_id: number): string {
    return `${CACHE_PREFIX}:${store_id}`;
  }

  /**
   * Devuelve el catálogo memorizado o `null` si no hay nada usable.
   *
   * Todo fallo —Redis caído, JSON corrupto, forma inesperada— devuelve `null`,
   * que el llamador interpreta como «fallo de caché» y resuelve contra base. El
   * endpoint nunca falla por la caché: sirve más lento y correcto.
   */
  async read(store_id: number): Promise<CatalogEntry[] | null> {
    assertValidStoreId(store_id);
    try {
      const raw = await this.redis.get(this.cacheKey(store_id));
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      // Se comprueba la forma, no sólo que parsee. Un despliegue anterior pudo
      // dejar en Redis una forma distinta con el mismo prefijo, y confiar en
      // ella devolvería `undefined` al frontend en cada campo.
      if (!Array.isArray(parsed) || !parsed.every(isCatalogEntry)) {
        this.logger.warn(
          `Catálogo en caché con forma inesperada para la tienda ${store_id}: se descarta`,
        );
        return null;
      }
      return parsed;
    } catch (error) {
      this.logger.warn(
        `Fallo al leer el catálogo en caché de la tienda ${store_id}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async write(store_id: number, entries: CatalogEntry[]): Promise<void> {
    assertValidStoreId(store_id);
    try {
      await this.redis.set(
        this.cacheKey(store_id),
        JSON.stringify(entries),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Fallo al escribir el catálogo en caché de la tienda ${store_id}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Invalida el catálogo de una tienda. **Nunca lanza.**
   *
   * Se llama después de escribir en base, no antes: invalidar primero deja una
   * ventana en la que un lector repuebla la caché con el estado viejo y la deja
   * rancia durante todo el TTL. Invalidar después puede dejar la caché vieja si
   * el proceso muere entre las dos, y eso lo acota el TTL.
   */
  async invalidate(store_id: number): Promise<void> {
    try {
      assertValidStoreId(store_id);
      await this.redis.del(this.cacheKey(store_id));
    } catch (error) {
      this.logger.warn(
        `Fallo al invalidar el catálogo de la tienda ${store_id}: ${(error as Error).message}`,
      );
    }
  }
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  const entry = value as CatalogEntry;
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.id === 'number' &&
    typeof entry.name === 'string' &&
    typeof entry.operation_type === 'string' &&
    typeof entry.is_default === 'boolean' &&
    typeof entry.current_version === 'number'
  );
}
