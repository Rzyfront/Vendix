# Reporte final: matriz de accesos por plan, paywall de módulo y recalibración de IA

Rama `feat/accesos-por-plan` desde `origin/develop` 5757831a2. Spec: `odd/tasks/planes-matriz-accesos.md` (§2–§5).

## Historia de usuario

Como **dueño de una tienda con plan Vendix Impulsa o Emprendedor** en el panel de administración, quiero **ver en el menú los módulos que mi plan no incluye, con un candado, y al abrirlos entender qué plan los trae y cuánto cuesta** para **decidir si mejoro mi plan sin perderme ni chocar con errores**.

Pasos en pantalla (con el flag de la capa plan encendido):
1. Entrar a `https://<tienda>.vendix.com/admin` con un plan Impulsa.
2. En el menú lateral, **Facturación**, **Contabilidad**, **Nómina**, **Cartera** y **Fiscal** siguen visibles con un candado («No incluido en tu plan»).
3. Clic en **Facturación** → no entra; se abre el paywall: «Facturación electrónica no está en tu plan», una línea de valor, «Tu plan actual: Vendix Impulsa», «Disponible en» Empresarial Pro e IA Business con precio y el botón **«Ver planes y mejorar»**.
4. «Ver planes y mejorar» → `/admin/subscription/plans?plan=<código>&cycle=<ciclo>&from=invoicing`: el ciclo viene preseleccionado, el plan recomendado resaltado y un aviso nombra el módulo.
5. Volver a intentar Facturación en la misma sesión → solo un aviso corto (un paywall por módulo por sesión).
6. El dashboard, Suscripción, Cuenta/Configuración y Ayuda nunca se bloquean.

Criterios de aceptación observables:
- Sin el flag (modo auditoría, por defecto) nadie ve cambios: todo abre como hoy y el backend registra `ACCESS_AUDIT` con `layer: "plan"` y `decision: "would_block"`.
- Con el flag: URL directa, Vexi y la API bloquean; menú y tarjeta de Apps muestran el módulo con candado / «Disponible en un plan superior».
- La API responde `403 PLAN_MODULE_NOT_INCLUDED` con `{ module, module_name, current_plan, required_plans: [{code,name,price,currency,cycle}], upgrade_url }` y el frontend abre el mismo paywall.
- La página de planes sin query se ve exactamente igual que antes.

## Alcance entregado

| Bloque | Qué se hizo |
|---|---|
| Datos | Tabla `plan_module_rules` (`exclusive`/`blocked`), migración aditiva e idempotente `20261110090000_plan_module_rules` con reglas sembradas para las líneas activas (Impulsa/Emprendedor: 35 bloqueados; Empresarial Pro: 35 exclusivos; IA Business: 37 exclusivos con `flows` y `documents`). Promocionales y archivados quedan fuera. |
| IA | `ai_feature_flags` de las 4 líneas según §5.1 (base anual exclusiva; ÷5, ×1, ×2, ×20) **solo en el seed de desarrollo** (`prisma/seeds/plan-commercial-lines.seed.ts`). Producción no se toca. |
| Mapa | `libs/shared-types/plan-modules.ts` + copias byte-idénticas en backend y frontend + spec de paridad (copias, bloques de la migración, invariantes, mapa API). |
| Backend | Capa `plan` en `AccessLayer` y `ACCESS_AUDIT`; `PlanModuleRulesService`, `PlanAccessService`, `PlanAccessGuard` global (tras auth, permisos y operaciones de tienda); plan incluido en `GET /store/access-gate` y `/organization/access-gate`; error `PLAN_MODULE_NOT_INCLUDED`. |
| Frontend | 4ª condición `plan` en `MenuFilterService.canSeeKey` para `sidebar`, `url`, `apps_card`, `vexi`; candado en el menú; paywall de módulo (`PlanPaywallService` + `PlanPaywallOutletComponent`) montado en el layout de tienda; guard de ruta, interceptor del 403, Vexi y tarjeta de Apps conectados; preselección de plan y ciclo en la página de planes. |

## Cómo activar el bloqueo (`enforce`)

La capa plan tiene flag propio, independiente del de industria:

```bash
# todas las tiendas
redis-cli SET access_gate:plan:enforce:all 1
# una tienda
redis-cli SET access_gate:plan:enforce:store:<store_id> 1
# volver a auditoría
redis-cli DEL access_gate:plan:enforce:all
```

Recomendación: dejar 7 días en auditoría y revisar `ACCESS_AUDIT` con `layer: "plan"` antes de encender.

## Cómo probar

1. Aplicar la migración (`prisma migrate deploy`) y correr el seed de desarrollo.
2. Asignar a una tienda de prueba un plan `vendix-impulsa` y entrar con su owner.
3. En auditoría: navegar a `/admin/invoicing`; entra y `docker logs vendix_backend | grep ACCESS_AUDIT` muestra `"layer":"plan","decision":"would_block"`.
4. `SET access_gate:plan:enforce:store:<id> 1`, recargar: candados en el menú, paywall al abrir Facturación, `curl` a `/api/store/invoicing` devuelve 403 `PLAN_MODULE_NOT_INCLUDED`.
5. Cambiar la tienda a `empresarial-pro-monthly`: Facturación abre; `/admin/flows` (cuando exista) mostraría el paywall de IA Business.

## Resultados de pruebas

Backend (jest, `--runInBand`, un spec por invocación):

| Spec | Resultado |
|---|---|
| `common/access/plan-modules.parity.spec.ts` | PASS |
| `common/access/access-gate-mode.service.spec.ts` | PASS (43 tests junto con el anterior) |
| `common/access/plan-module-rules.service.spec.ts` | PASS 6/6 |
| `domains/store/subscriptions/services/plan-access.service.spec.ts` | PASS 8/8 |
| `domains/store/subscriptions/guards/plan-access.guard.spec.ts` | PASS 12/12 |

Nota: los specs que importan `GlobalPrismaService` se corrieron con ts-jest `isolatedModules` (transpile-only): el typecheck completo del cliente Prisma generado agota 4 GB de heap en esta máquina. El tipado se cubrió con el typecheck acotado.

Typecheck acotado backend (`tsc --noEmit` sobre los archivos tocados y sus imports): sin errores propios. Único error: `src/messaging/providers/sns-sms.provider.ts: Cannot find module '@aws-sdk/client-sns'` — ajeno al cambio (dependencia no instalada en local), registrado y no bloqueante.

Frontend (Karma, una corrida con los 7 specs tocados: `menu-filter.service`, `plan-paywall.service`, `plan-catalog.preselect`, `panel-ui.guard`, `store-dashboard.guard`, `store-admin-menu-items`, `route-gate-coverage`): **120/121 SUCCESS**. El único fallo, «store module catalog no deja rutas huérfanas» (`settings_print_formats` en `MODULE_ROUTES` sin entrada en `APP_MODULES`), ya existe en la base 5757831a2 y es ajeno a este cambio; registrado, no corregido (fuera de alcance).

Typecheck acotado frontend (`ngc` real sobre los 9 archivos de producción tocados y sus imports): sin errores propios. Los 3 errores restantes (`SerialPort`, `navigator.serial` en `pos-scale.service.ts`) se deben a que el tsconfig acotado no incluye la declaración ambiental de Web Serial; no son del cambio.

Auditoría zoneless (`scripts/zoneless-audit.sh`): sin hallazgos en archivos tocados (los ❌ globales son preexistentes).

Dry-run de la migración en `vendix_db` local dentro de `BEGIN … ROLLBACK`: aplica dos veces sin error (idempotente), excluye el plan promocional y deja la base sin la tabla al revertir.

## Commits

- `aa21871af` feat(access): matriz de módulos por plan y recalibración de IA ⚠️ migración
- `7ecfae32c` feat(access): capa plan en la compuerta de accesos del backend
- `53534542e` feat(access): candado de plan y paywall de módulo en el panel
- docs: este reporte

## Fuera de alcance / pendiente

- Implementar los módulos **Flujos** y **Documentación** (solo se siembran sus reglas como exclusivas de IA Business).
- Límites de usuarios e industrias por plan (§6.2 sigue abierta).
- Página de planes en el panel de organización: allí el bloqueo muestra un aviso corto y vuelve al dashboard.
- UI de edición de la matriz y evento de invalidación de caché (hoy la caché de reglas expira a los 60 s).
- Endpoints compartidos entre módulos (impuestos, cartera AR/AP, escáner de compras, factura POS, plan de cuentas, empleados) quedan sin compuerta en la API para no romper flujos de planes base; la pantalla sí lleva candado.
- La ruta real de la página de planes es `/admin/subscription/plans` (el `/planes` del brief es conceptual).
- Ninguna escritura, deploy ni release en producción.
