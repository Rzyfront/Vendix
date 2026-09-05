---
name: vendix-known-errors
description: >
  Catálogo canónico de errores conocidos de Vendix, agrupado por área
  (TypeScript, Angular, HTML, CSS/Tailwind, NestJS, Prisma/SQL, build,
  testing, git). Cada entrada da el síntoma engañoso y la regla que lo evita.
  Trigger: antes de depurar cualquier fallo cuyo síntoma no señale su causa,
  y antes de dar por bueno un verde (build, test, curl, PASS de un agente).
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Depurar un error cuyo síntoma no señala su causa"
    - "Un build, test o sonda pasa en verde y hay dudas de que la cobertura sea real"
    - "Interpretar un error de compilación de TypeScript, SWC, ngc o tsc"
    - "Un cambio compila y pasa tests pero falla en runtime"
    - "El dev server cae en bucle o el dist queda inconsistente"
    - "Verificar el reporte de compilación o de pruebas de otro agente"
    - "Escribir o revisar una migración de base de datos"
    - "Commitear o empujar en un árbol de trabajo compartido con otras sesiones"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Errores conocidos de Vendix

## Purpose

Catálogo de trampas ya pagadas en este repositorio. Gobierna **cómo interpretar un fallo**, no cómo escribir una feature: cada entrada existe porque su síntoma apunta al lugar equivocado y costó horas.

No gobierna las convenciones de cada dominio — para eso están los skills de área (`vendix-frontend`, `vendix-backend`, `vendix-prisma`, `buildcheck-dev`). Este skill es la lista de lo que **no** hay que volver a descubrir.

## Core Rules

1. **Un verde no es evidencia hasta saber qué midió.** Un build que compila, un test que pasa, un curl que devuelve 200 y un PASS reportado por otro agente pueden ser todos ciertos y no probar nada. Casi todas las entradas de este catálogo son variantes de eso.
2. **El archivo que reporta el error puede no ser el que lo causa.** Antes de creerle a la línea que señala el compilador, verificar que el fallo esté ahí.
3. **Si el síntoma es raro y la causa parece infraestructura, sospechar del código primero.** «Es VirtioFS», «es la caché», «es Docker» fueron la explicación equivocada más de una vez, y reiniciar el entorno afecta a todas las sesiones del árbol compartido.

---

## TypeScript y JavaScript

| Síntoma | Causa y regla |
|---|---|
| Errores de tipo en líneas sin relación con el cambio; `TS2304: Cannot find name 'app'` sobre un identificador que solo existe en un comentario | Un **backtick crudo dentro de `template:` o `styles: [\`…\`]`** cierra el template literal; lo que sigue se parsea como TypeScript. En comentarios dentro de un literal: escapar (`\``) o no usar backticks. Prueba aislada: `npx tsc --noEmit --skipLibCheck <archivo>` y grepear `TS1010\|TS1002\|TS2365\|TS2304`. Detalle en `vendix-frontend`. |
| `tsc` reporta un puñado de errores y al arreglarlos aparecen decenas más | Un **error sintáctico apaga el análisis semántico**. El primer marcador esconde el resto; no estimar el trabajo por el conteo inicial. |
| Un `@Transform` de un DTO no se ejecuta como se espera, pero el test del DTO aislado pasa | **`enableImplicitConversion` gana al `@Transform`**: el transform recibe el valor ya coaccionado. Probar contra el pipeline real, no contra el DTO suelto. |
| Una suma de porcentajes que debería fallar por punto flotante da exacto | `33.33 × 2 + 33.34` **sí** da 100. El caso intuitivo no prueba el error; para dinero y porcentajes usar `Decimal`, y elegir el caso de prueba que sí desborda. |
| `for x in $VAR` itera una sola vez en un script | **zsh no hace word-splitting** como bash. Usar `${(z)VAR}` o un arreglo explícito. |
| La salida de `rg` sale corrupta sin error | **`rg -r` es *replace***, no recursivo. Para filtrar extensiones: `-g '*.ts'` (`--include` es de grep). |
| Un `jq` deja el objeto vacío en vez de dejarlo intacto | Un filtro que no matchea **aniquila** el objeto. Vacío no significa «no pasó nada». |

## Angular — reactividad y formularios

| Síntoma | Causa y regla |
|---|---|
| Una condición del template nunca cambia | **Signal usado sin invocar**: `!this.flag` en vez de `!this.flag()`. Siempre truthy. |
| Un `computed()` no reacciona a un `FormControl` | Los `FormControl` no son señales. Puentear con `toSignal(control.valueChanges)` y **declarar `initialValue`**. |
| Un formulario aborta la detección de cambios con `NG01350` | **`ngModel` dentro de un `formGroup`** sin `[ngModelOptions]="{standalone: true}"`. |
| Una precarga pisa datos ya tecleados por el usuario | **`setValue` no marca `dirty`**: no sirve para distinguir «lo puso el usuario» de «lo puso el código». |
| `takeUntilDestroyed()` lanza fuera de un contexto de inyección | Pasarle el `destroyRef` explícito. |
| Detección de cambios corriendo sin parar | **`transition: all`** reinicia el ciclo. Enumerar las propiedades a animar. |
| Un valor de moneda parpadea o muestra otro formato | **`CurrencyPipe` impuro**: hay una carrera. Formatear en un `computed()`. |
| Un modal proyectado con `ng-content` conserva estado viejo al reabrirse | **El contenido proyectado no se destruye** con el modal. Usar una señal-época para forzar el remount. |
| Un `@defer` nunca sale del skeleton | En una **pestaña oculta** el viewport nunca entra. No es un cuelgue. |
| Un `as any` en el template da error en un punto que no lo tiene | El parser reporta en la **apertura del binding**, no donde está el cast. |

Para lo demás de Zoneless y señales: `vendix-zoneless-signals`.

## HTML y accesibilidad

| Síntoma | Causa y regla |
|---|---|
| axe reporta «button missing accessible name» sobre un elemento que ya tiene `aria-label` | Verificar si el componente **ya envuelve el contenido en un `<button>` real**. Agregarle `role="button"` + `tabindex="0"` al contenido interno crea **contenido interactivo anidado** y un doble punto de tabulación — peor que el original. |
| Varios `H1` en una misma página | El shell (header, sidebar) y la vista emiten título a la vez. El nombre del módulo o de la organización **no es** título de página. Al degradar un `H1` del shell, verificar antes cuántas vistas quedan sin ninguno y darles un `<h1 class="sr-only">`. |

## CSS y Tailwind

| Síntoma | Causa y regla |
|---|---|
| Un color con opacidad no se aplica | El token `primary` **no compone con `/opacity`**. |
| Un `rgba()` con variables no pinta | Desajuste de sintaxis: el token guarda los canales, hay que escribir `rgba(var(--token), α)`. |
| Un override móvil no gana | **Orden de `@media` en el fuente**: los overrides móviles van al final. |
| Un contenedor colapsa a altura cero | **`flex: 1`** implica `flex-basis: 0`, que anula el alto automático. Usar `flex-grow` solo, o `min-height`. |
| Un PDF o impresión colapsa columnas que en pantalla se ven bien | **A4 mide ~794 px**: cae en el breakpoint móvil. |
| Una vista de admin no scrollea | El contenedor de scroll es el `<main overflow-y-auto>` del layout. |

## NestJS y backend

| Síntoma | Causa y regla |
|---|---|
| Un `@Permissions` no protege nada, pero compila y pasa revisión | **`PermissionsGuard` no es global.** Solo hay 4 `APP_GUARD` en el repo (`app.module.ts`). Sin `@UseGuards(PermissionsGuard)` explícito, el decorador es metadata inerte. Ojo con copiar un controller que se protege con `@Roles` — ahí los `@Permissions` son decorativos. |
| Un 200 con token de `super_admin` «prueba» que el permiso funciona | **No prueba nada**: el guard tiene bypass para super_admin. Lo que prueba el cierre es el **403 del rol sin el permiso** y el **200 del rol que sí lo tiene**. |
| Un endpoint devuelve 201 con un cuerpo de error, o 200 con `success: false` | **`responseService.error` retorna, no lanza.** Falta el `return`/`throw` en el handler. |
| Un error del backend llega al frontend como mensaje genérico | Un servicio **se traga el `HttpErrorResponse`**. Re-lanzar el error crudo y dejar que el consumidor lo formatee. |
| Un `throw` dentro de un `@OnEvent` desaparece | **`suppressErrors` es `true` por defecto.** |
| Una ruta estática responde con el handler de un `:param` | **El orden del arreglo `controllers:`** decide. El 500 suele nombrar un servicio ajeno. |
| Un `@Sse()` ignora los parámetros de query validados | **`@Sse()` lee `req.query` crudo**; el DTO no se aplica. |
| El build y los tests pasan pero la app no arranca | El **grafo de dependencias de Nest solo se valida al arrancar**. |
| Arranca limpio y revienta en la primera petición | **Export ausente bajo SWC**: no se detecta en compilación. |
| Un job de BullMQ reintenta más de lo configurado | **`stalled` no pasa por `attempts`**; `maxStalledCount` es otro contador. |

## Prisma, base de datos y SQL

| Síntoma | Causa y regla |
|---|---|
| Una fecha aparece un día antes | Columna **fecha-sola leída como `Timestamp` en UTC**. Ver `vendix-date-timezone`. |
| `updated_at` no refleja cambios | **Sin `@updatedAt` no se mueve solo.** Que algunas filas la tengan poblada es justo lo que engaña: no es auditoría. |
| Un `CHECK` no aparece al inspeccionar el esquema | **`information_schema` no expone constraints.** Usar `pg_constraint`. |
| Un impuesto de `19` desborda la columna | `Decimal(6,5)` guarda **fracción** (`0.19`), no porcentaje. |
| El impuesto de cabecera descuadra por un céntimo | La cabecera es **Σ de los impuestos de línea**, nunca `base × tarifa`. |
| Una consulta devuelve datos de otro tenant | **Getters sin scope**: en `EcommercePrismaService` varios modelos devuelven el `baseClient`. Un `findFirst` sin `where` cruza tenants. |
| `prisma generate` mata el backend | **OOM dentro del contenedor.** Hay dos clientes: el del host (para jest/tsc) y el del contenedor (para Nest); generar en ambos, y no vía `exec` sobre el contenedor con Nest vivo. |

**Migraciones — prohibiciones absolutas.** Sin autorización explícita documentada **y** snapshot de producción: `TRUNCATE … CASCADE`, `DROP TABLE` sin renombrado previo, `DROP COLUMN` con datos productivos, `DELETE`/`UPDATE` sin `WHERE`, `ON DELETE CASCADE` en tablas padre con datos de negocio. **`TRUNCATE CASCADE` ignora `ON DELETE RESTRICT` y `SET NULL`**: eliminar la FK antes de limpiar la tabla padre. Todo cambio de DB va por migración versionada. Ver `vendix-prisma-migrations`.

## Build, Docker e infraestructura

| Síntoma | Causa y regla |
|---|---|
| Un agente reporta `buildcheck PASS` sobre código que no compila | **El log vive en una ruta compartida del repo.** Con varias sesiones, cada una pisa a la anterior: el PASS leído puede ser de otra corrida. Correr `npm run buildcheck:fe > /ruta/propia/log 2>&1; echo $?` y leer el **exit code**. Quien orquesta corre el suyo antes de empujar. Detalle en `buildcheck-dev`. |
| Un buildcheck tarda exactamente 900 s con un typecheck de 48 s | **El pipe quedó colgado** con un `sleep` huérfano; el total clavado en el timeout no es casualidad. El PASS puede seguir siendo válido, pero el script no terminó limpio. |
| `esbuild` falla con «falsy value: (compilation)» y ningún otro error | **Solapamiento de rebuilds** (reescribir un archivo entero dispara dos eventos). Reiniciar, no depurar. |
| El dist queda con un `SyntaxError` en un archivo distinto cada arranque | **VirtioFS desgarra la escritura del dist de SWC.** `colima restart` **no** lo cura. |
| «Successfully compiled: 1 file» pero no hay `main.js` | **`.tsbuildinfo` sobrevive a `deleteOutDir`.** Muerto con log verde. |
| Build verde y `ENOENT` al arrancar | **Assets JSON fuera del `dist`**: falta declararlos en `nest-cli.json`. |
| `docker logs --since` devuelve una ventana vacía | **`--since` es hora local, el log es UTC.** Contar ciclos en vez de acotar por tiempo. |
| Un `prune` no libera espacio en disco | Falta `colima ssh -- sudo fstrim -a -v`; el disco es sparse. |
| Cambios de frontend que no aparecen tras reiniciar | **La caché de Angular sobrevive al restart**: borrar `.angular/cache`. |
| El build del backend typechequea archivos ajenos al cambio | **El scope abarca todo el repo**: usar `tsc -p tsconfig.build.json`. |
| 502 con todos los contenedores sanos | **DNS rancio en nginx.** Si además falta el contenedor, `docker ps -a` primero. |

Puertos y contenedores: `docker restart`, **nunca matar PIDs**.

## Testing y sondas

| Síntoma | Causa y regla |
|---|---|
| «107 de 107 tests pasaron» | Leer **Test Suites**, no Tests: una **«suite failed to run»** no ejecuta nada y no resta. Verificar además que el gate de CI no esté apagado (`if: false`). |
| Un test muere con un mensaje que parece error de compilación | **SIGKILL** por techo de memoria del contenedor; se lee igual en el resumen. |
| Un `curl` a `/api/...` devuelve 200 con HTML | **El catch-all del SPA responde.** Apuntar a `localhost:3000` y exigir `Content-Type: application/json`. |
| Un `curl` prueba un fix que aún no estaba compilado | **La sonda mide el `dist`, no el código fuente.** Comparar la hora de la sonda con la de la recompilación. |
| Un login inválido devuelve 200 | El cuerpo trae `success: false`. El código HTTP no alcanza. |
| Dos agentes sondean y uno lee la respuesta del otro | **Nombre de archivo temporal fijo**: un `curl` fallido no escribe y `head` lee lo anterior. Usar rutas únicas por sesión. |
| Un snapshot de Playwright no muestra el nombre accesible de un elemento | **El snapshot lo elide**, y `find` hereda la elisión. Dos señales, una sola causa. |
| Un intento de contar impresiones da 0 aunque sí imprimió | **El iframe es un realm de JavaScript separado**: parchear `window.print` del padre no lo intercepta. Usar un `MutationObserver` que parchee `contentWindow.print` de cada iframe al agregarse. |

## Git y árbol de trabajo compartido

Varias sesiones de agente comparten el mismo árbol e índice. De ahí:

| Síntoma | Causa y regla |
|---|---|
| Un commit se lleva archivos de otra sesión | **Nunca `git add -A` ni `git add .`.** Commitear con rutas explícitas: `git commit -- <ruta>`. |
| Un commit propio aparece en la rama equivocada, o HEAD no es el que se leyó | **HEAD se mueve solo.** Tomar el hash **en el mismo momento** en que se reporta o se usa. |
| Un push sube commits que no se auditaron | `git push origin develop` empuja **el tip de la rama**, no lo auditado. Empujar por sha: `git push origin <sha>:develop`, con una guarda previa que compare `git rev-parse HEAD` contra el sha auditado y aborte si cambió. |
| Un conflicto que no debería existir | **`git patch-id`** prueba si es fantasma. |
| `gh pr review --approve` falla en el propio PR | No se puede aprobar el PR propio: el veredicto va como `--comment`. |

## Decision Rules

| Situación | Qué hacer |
|---|---|
| El síntoma señala un archivo que no se tocó | Buscar la entrada correspondiente antes de depurar ese archivo. |
| Todo está verde y hay que dar un veredicto | Preguntar qué midió cada verde. Un PASS ajeno no cuenta. |
| La causa parece ser el entorno (Docker, VirtioFS, caché) | Descartar primero las causas de código de este catálogo. Reiniciar el entorno afecta a todas las sesiones. |
| Aparece una trampa nueva que costó más de una hora | Agregarla acá con su síntoma engañoso, y guardarla en Engram (`vendix-engram`). |

## Related Skills

- `buildcheck-dev` — cómo correr la compilación sin levantar servidores
- `vendix-zoneless-signals` — reglas de Zoneless y señales (obligatorio en frontend)
- `vendix-prisma-migrations` — patrones seguros y recuperación de migraciones
- `vendix-permissions` / `vendix-backend-auth` — autorización y guards
- `how-to-test` — diseño de pruebas y credenciales
- `git-workflow` — ramas, commits y PRs
- `vendix-engram` — dónde persistir una trampa nueva
