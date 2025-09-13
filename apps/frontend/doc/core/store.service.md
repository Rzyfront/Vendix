# StoreService

Ubicación: `src/app/core/services/store.service.ts`

## Propósito
Gestionar el estado de la tienda actual y obtener datos por dominio o slug.

## Funciones
- getStoreByDomain(domain): Observable<Store>
- getStoreBySlug(slug): Observable<Store>
- setCurrentStore(store), getCurrentStore(), clearCurrentStore()
- loadStoredStore(): rehidrata desde localStorage (solo browser)

## Notas
- Usa `environment.apiUrl` para construir URLs.
- Protección SSR via `PLATFORM_ID`.
