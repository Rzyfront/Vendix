import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { extractClientIp } from '../utils/client-ip.util';

/**
 * Throttler global llaveado por la IP real del cliente.
 *
 * ## El fallo que corrige
 *
 * `ThrottlerGuard` de fábrica llavea por `req.ip`. Sin `trust proxy` eso era
 * la IP de nginx / la gateway de Docker, idéntica para todo el mundo, así que
 * el límite de `[{ ttl: 60000, limit: 100 }]` no era «100 peticiones por
 * minuto por cliente» sino «100 peticiones por minuto para TODA la
 * plataforma». Un solo panel abierto dispara decenas de peticiones en
 * paralelo al cargar; con tres usuarios trabajando a la vez el techo se
 * alcanzaba en segundos y la API respondía 429 a todos.
 *
 * ## Por qué llavea por IP y no por usuario
 *
 * Rastrear por `user.id` sería más justo, pero no es posible acá y la manera
 * de forzarlo abre un agujero:
 *
 *  1. Este guard está registrado en `app.module.ts` ANTES de `JwtAuthGuard`,
 *     así que cuando corre, `req.user` todavía no existe. Sería `undefined`
 *     siempre y el rastreo caería a IP igualmente, sólo que en silencio.
 *  2. Reordenar los guards para que el JWT corra primero dejaría sin contar
 *     las peticiones sin token a rutas privadas: `JwtAuthGuard` las rechaza
 *     con 401 antes de llegar acá, y una inundación anónima pasaría sin
 *     límite. Es justo el tráfico que más importa limitar.
 *  3. Decodificar el JWT sin verificar la firma para sacar el `sub` haría el
 *     rastreo falsificable: bastaría rotar un `sub` inventado en cada
 *     petición para tener presupuesto infinito.
 *
 * Con `trust proxy` bien fijado, la IP real ya separa a los clientes entre sí,
 * que es el problema que había. Afinar por usuario exigiría un segundo guard
 * después del JWT, y eso es otra pieza, no un retoque de ésta.
 */
@Injectable()
export class VendixThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    return extractClientIp(req);
  }
}
