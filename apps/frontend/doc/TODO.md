# TODO — Frontend Roadmap

Este documento lista las tareas prioritarias, la implementación del estado con NgRx y los pendientes generales para completar la arquitectura multi-tenant.

## Correcciones prioritarias (arreglar lo que está mal)

- [x] Centralizar URLs de API en environment
  - Reemplazar hardcodes http://localhost:3000 por environment.apiUrl en: core/AuthService, TenantConfigService, DomainDetectorService, module auth service, StoreService.
- [x] Usar environment.production en DomainDetector
  - Sustituir production=false por environment.production y mover mapeos dev a config/flag.
- [x] Unificar resolución de tienda por dominio
  - Refactor App.initializeApp a usar DomainDetectorService; de ser tienda, fetch por slug con StoreService; alinear tipos DomainResolution/Store.
- [x] Integrar AppInitializer en bootstrap
  - Registrar APP_INITIALIZER o invocarlo al inicio para correr Domain→Tenant→Theme antes de mostrar UI; añadir overlay de carga.
- [x] Endurecer AdminGuard (roles)
  - Validar isLoggedIn + isAdmin (o data:roles); fallback a /auth/login si no cumple.
- [x] Fortificar Auth core y refresh
  - Proteger localStorage con PLATFORM_ID; tipar refreshToken; manejar rotación de refresh_token; redirecciones por rol.
- [x] Acotar AuthInterceptor a API base
  - Adjuntar Authorization solo si URL comienza con environment.apiUrl; mantener flujo de refresh 401.
- [x] Limpiar rutas Store duplicadas
  - Decidir estrategia: lazy feature storeRoutes en path 'store' y eliminar ruta directa; mantener una sola fuente.
- [x] Renombrar AuthService del módulo
  - Renombrar a AuthRegistrationService; mover base URL a environment; ajustar imports y docs.
- [x] Higiene SSR en servicios
  - Auditar que no haya acceso a window/localStorage/DOM en constructores; usar PLATFORM_ID guards.
- [x] Tests unitarios críticos
  - Agregar tests para DomainDetector (mappings y API), TenantConfig (cache/fetch), AuthInterceptor (refresh).
- [x] Actualizar documentación
  - Sincronizar MULTI_TENANT_ARCHITECTURE.md y enlazar nuevos MD en doc/core y módulos.

## TODO — NgRx Modular (estado)

- [x] Instalar paquetes NgRx
  - @ngrx/store @ngrx/effects @ngrx/entity @ngrx/store-devtools (y @ngrx/store-localstorage opcional).
- [x] Configurar store global (standalone)
  - Añadir provideStore({}), provideEffects([]), provideStoreDevtools() en app.config; activar runtime checks.
- [x] Configurar multi-tenant en estado
  - Crear feature 'tenant' (actions/reducer/effects/selectors/facade); APP_INITIALIZER que dispare init con domain → tenantId.
- [x] Crear base de feature store por módulo
  - En cada módulo: carpeta store/ con actions, reducer, selectors, effects, facade, models; registrar con provideState/provideEffects en rutas lazy.
- [x] Consumir Facades en componentes
  - Inyectar facades, usar select para leer estado y dispatch para acciones; components con ChangeDetection.OnPush.
- [x] Centralizar selectores
  - Definir createFeatureSelector/createSelector en cada feature; opcional: carpeta global para selectores compuestos.
- [x] Persistencia de estado (opcional)
  - Configurar @ngrx/store-localstorage con keys por tenantId; hidratar al iniciar.
- [ ] Rendimiento y debug
  - Runtime checks, DevTools habilitado en no-prod, OnPush, trazas de acciones clave.
- [ ] Nuevas features en NgRx
  - Repetir misma estructura modular por feature (users, stores, products, orders, etc.) con lazy loading y efectos por dominio.

## Lo que falta o quedaría por completar

- [ ] Rutas dinámicas por entorno (avanzado)
  - Usar router.resetConfig según AppEnvironment para cargar solo módulos aplicables.
- [ ] Overlay de init y telemetría
  - Agregar overlay/skeleton durante init; log/telemetry de errores de init (domain/tenant/theme).
- [ ] Alinear endpoints backend/frontend
  - Acordar contrato para domain resolve y store fetch (tipos, rutas) y actualizar servicios.
- [ ] E2E de auth y guardias
  - Pruebas de login, redirecciones, acceso a /admin por rol y expiración/refresh.
