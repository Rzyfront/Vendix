## 6) Registrar CORS dinámicamente para dominios activos en el backend (NestJS)

Objetivo
- Validar `Origin` de peticiones CORS consultando la base de datos de `domain_settings` y permitir solo orígenes autorizados.

Principios clave
- Nunca devolver `Access-Control-Allow-Origin: *` si `Access-Control-Allow-Credentials: true`.
- Validar y permitir sólo orígenes exactos (scheme + host + optional port).
- Cachear resultados por dominio para evitar consultas excesivas a la DB.
- Registrar y alertar orígenes no autorizados si son frecuentes.

Implementación (paso a paso)

1) Añadir campo `cors_origins` en `domain_settings.config.security` (ya existe en el seed como ejemplo).

2) Implementar una función dinámica de CORS en `main.ts` (ejemplo):

```ts
import LRU from 'lru-cache';
// ... crear app Nest

const cache = new LRU({ max: 2000, maxAge: 60 * 1000 });

const dynamicOrigin = async (origin: string | undefined, callback) => {
  if (!origin) return callback(null, true); // no origin => allow (server-to-server/Postman)

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();

    const cached = cache.get(hostname);
    if (cached !== undefined) return callback(null, cached);

    // Usa tu servicio para buscar domain by hostname
    const domainService = app.get(DomainResolutionService);
    let allowed = false;

    try {
      const domain = await domainService.resolveDomain(hostname);
      const corsList = domain?.config?.security?.cors_origins || [];
      // comparar origin completo (p.ej. 'https://vendix.com')
      allowed = corsList.includes(origin) || corsList.includes(parsed.origin);
    } catch (e) {
      allowed = false;
    }

    cache.set(hostname, allowed);
    callback(null, allowed);
  } catch (e) {
    callback(null, false);
  }
};

app.enableCors({ origin: dynamicOrigin, credentials: true });
```

3) Cache invalidation
- Cuando se actualice `domain_settings` (crear/editar/eliminar), emite un evento (`domain.cache.invalidate`) para limpiar la entrada cacheada. Ya hay ejemplo en `DomainResolutionService` que escucha `domain.cache.invalidate`.

4) Edge cases / validaciones
- Asegúrate que `cors_origins` guarde orígenes exactos (ej: `https://vendix.com`, `https://store.customer.com`).
- Para permitir subdominios dinámicos, almacena explícitamente cada origen necesario (evita patrones tipo `*.customer.com` a menos que lo controles completamente y lo valides).

5) Seguridad adicional
- Limitar endpoints que aceptan CORS dinámico (por ejemplo solo la API pública que necesita servir frontend público). Para endpoints internos admin, permitir sólo orígenes internos.
- Rate-limit y WAF para endpoints públicos.

---

Con esto puedes dar de alta un dominio en la app, activar su `cors_origins` y el backend reaccionará dinámicamente sin necesidad de reiniciar.
