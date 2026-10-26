---
name: vendix-known-errors
description: >
  Catálogo de errores conocidos de Vendix por área (TS, Angular, NestJS, Prisma, build, tests, git): síntoma engañoso y regla que lo evita.
  Trigger: depurar un fallo cuyo síntoma no señala su causa o validar un verde.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Errores conocidos de Vendix

Trampas ya pagadas: cada entrada existe porque su síntoma apunta al lugar equivocado. Gobierna **cómo
interpretar un fallo**, no cómo escribir una feature (eso son los skills de área).

Catálogo completo por área (TS/JS, Angular, HTML/a11y, CSS/Tailwind, NestJS, Prisma/SQL,
build/Docker, testing, git, impresión térmica): `references/catalog.md` (leer bajo demanda; buscar
por síntoma con `grep -n`).

## Reglas

1. **Un verde no es evidencia hasta saber qué midió.** Build, test, curl 200 o PASS de otro agente
   pueden ser ciertos y no probar nada.
2. **El archivo que reporta el error puede no ser el que lo causa.**
3. **Sospechar del código antes que de la infraestructura** («es VirtioFS/la caché/Docker» fue la
   explicación equivocada más de una vez); reiniciar el entorno afecta a todas las sesiones.

## Las que más cuestan

- `@Permissions` sin `@UseGuards(PermissionsGuard)` es metadata inerte: los únicos `APP_GUARD` son
  throttler, JWT, DomainScope y StoreOperations. Un 200 de `super_admin` no prueba permisos (bypass):
  probar 403 del rol sin permiso y 200 del rol con permiso.
- `responseService.error(...)` **retorna**, no lanza: sin `return`/`throw` sale 200/201 con `success: false`.
- Getters de `EcommercePrismaService` que devuelven `baseClient` (p. ej. `brands`, `stores`,
  `review_votes`) no tienen scope: un `findFirst` sin `where` cruza tenants.
- Re-declarar un `*PrismaService` en `providers:` crea otro `PrismaClient` (~68 MB) y parece fuga de
  heap; son singletons de `PrismaModule` (`npm run prisma-singleton:audit`).
- `@OnEvent` traga errores salvo `{ suppressErrors: false }`.
- Tests: leer **Test Suites**, no Tests («suite failed to run» no resta).
- `curl` a `/api/...` con 200 + HTML = catch-all del SPA: exigir `Content-Type: application/json`.
- Árbol compartido: nunca `git add -A`/`.`; commitear con rutas explícitas; tomar el sha en el momento de usarlo.
- Tickets térmicos: maquetar al ancho imprimible (`resolvePrintGeometry`), nunca a `width_mm`.

## Decisión

| Situación | Qué hacer |
|---|---|
| El síntoma señala un archivo que no se tocó | Buscar el síntoma en el catálogo antes de depurar ese archivo |
| Todo verde y hay que dar veredicto | Preguntar qué midió cada verde; un PASS ajeno no cuenta |
| La causa parece el entorno | Descartar primero las causas de código del catálogo |
| Trampa nueva que costó más de una hora | Agregarla al catálogo con su síntoma y guardarla en Engram (`vendix-engram`) |
| Una entrada ya no aplica (código corregido) | Quitarla o marcarla «corregido» en una línea |

## Related Skills

`buildcheck-dev` · `vendix-zoneless-signals` · `vendix-prisma-migrations` · `vendix-permissions` /
`vendix-backend-auth` · `how-to-test` · `git-workflow` · `vendix-engram` · `vendix-print-geometry` · `vendix-vex-agent`.
