# Vendix — instrucciones para agentes

Fuente única para Claude Code y Gemini CLI: `CLAUDE.md` y `GEMINI.md` son symlinks a este archivo.
Los skills viven en `skills/<name>/SKILL.md`; `./skills/setup.sh` los enlaza en `.claude/skills/` y `.agents/skills/`.
Responde en el idioma del usuario.

## Repo

- `apps/backend`: NestJS 11 + Prisma 7, corre en Docker (`vendix_backend`, worker `vendix_backend_worker`).
- `apps/frontend`: Angular 20 zoneless + signals. `npm run dev:fe` (nativo, :4200), pero se usa por el vhost `https://vendix.com` y sus subdominios (el `app_type` se resuelve por hostname).
- `apps/mobile`: **prohibido tocarlo** salvo que la tarea lo nombre explícitamente; entonces carga `mobile-dev` y edita solo ahí.
- `libs/` (`shared-types`, `print-formats`), `scripts/`, `skills/`.

## Flujo (ODD)

- Preguntas, análisis, revisiones y propuestas son de solo lectura: no edites hasta que se pida un cambio.
- Cambio pequeño (se puede retomar con el pedido + `git diff`) → inline, sin plan previo ni subagentes.
- Trabajo grande → un único documento de feature `odd/tasks/<feature>.md` (`## Specs`, `## Tasks`, `## Log`). Las Specs incluyen la decisión de negocio, los archivos críticos y lo que se reutiliza. Rafael lo aprueba antes de ejecutar. Si hay un plan aprobado y dice "ejecuta", se ejecuta tal cual.
- Subagentes solo con motivo nombrado (exploración grande, escritores paralelos independientes, contexto agotado, verificador de alto riesgo). Reciben la ruta de la tarea, los skills, los archivos en alcance y el comando de verificación.
- Worktrees permitidos salvo que Rafael diga lo contrario en la tarea.
- Carga el skill cuya descripción coincida con el área (backend, frontend, prisma, DIAN, inventario…). Cualquier archivo de frontend → `vendix-zoneless-signals` (sus violaciones son bugs silenciosos). Patrón nuevo sin skill → sugiérelo en una línea al cerrar.
- Alto riesgo (cargar su skill y marcarlo para RDD): migraciones y datos, DIAN y fiscal, dinero/pagos/suscripciones, auth y permisos, scoping por tenant.
- Cambio mínimo y en alcance; reutiliza patrones existentes; TypeScript sin `any` injustificado; no cambies comportamiento fuera del alcance; respeta los cambios ajenos del árbol.

## Tests y verificación

- Solo los tests del cambio, **una ruta por invocación** (rutas relativas a `apps/backend`):
  `npm run buildcheck:test -- src/<ruta>.spec.ts` o `npm run test:path -w apps/backend -- src/<ruta>`.
  "Suite del cambio" = el archivo o directorio tocado, nunca el proyecto.
- Prohibido: `npm test` sin ruta, `test:watch`, `test:debug`, `test:cov`, `ng test`, y dos procesos Node pesados a la vez (la máquina se cae).
- Sin build ni typecheck en desarrollo (CI los cubre), salvo pedido explícito. Ver `buildcheck-dev`.
- Verificación: `docker logs --tail 40 vendix_backend`; API con `curl` y usuario seed (`owner@techsolutions.co`, ver `apps/backend/prisma/seeds/users.seed.ts`), nunca Bruno salvo pedido; frontend con Playwright MCP (`--ignore-https-errors`) contra el vhost, nunca `localhost:4200`. Ver `how-to-test`.
- Tras cambiar un `*.module.ts` del backend: `npm run prisma-singleton:audit`.
- Prohibido `git stash` si hay otros cambios o agentes en el árbol; para comparar con el código anterior usa `git show HEAD:<ruta>`.

## Git

- Base: `develop` (ramas desde `origin/develop` y al día con ella). Nunca trabajar ni hacer push a `main`.
- Commits locales por unidad de trabajo permitidos (Conventional Commits). **Push, PR y merge solo con pedido explícito.**
- Cero firmas de IA en commits, PRs y comentarios (ni `Co-Authored-By`).
- Migraciones → alerta en el commit y en el PR. PR → gate `pr-code-review` ≥80 %, máximo 2 rondas de corrección. Detalle en `git-workflow`.

## Base de datos (inviolable)

- Cambios de DB solo vía migración versionada. Antes de crear o editar una migración, carga `vendix-prisma-migrations`.
- Prohibido sin autorización explícita de Rafael y snapshot de prod: `TRUNCATE … CASCADE`, `DROP TABLE` sin renombrar a `_deprecated_YYYYMMDD`, `DROP COLUMN` con datos, `DELETE`/`UPDATE` sin `WHERE`, `ON DELETE CASCADE` en padres con datos de negocio.
- Migraciones que mutan filas: cabecera `-- DATA IMPACT:`, FKs entrantes (`pg_constraint`) quitadas antes de limpiar el padre y dry-run con datos representativos.

## Memoria (Engram)

- Engram es la única memoria. Usa siempre el proyecto `vendix` (`--project vendix`).
- Sincronización de equipo (`.engram/chunks/`), onboarding y reglas: skill `vendix-engram`. Nunca guardes secretos.
