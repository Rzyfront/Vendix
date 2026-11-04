# Reservas: horario de la persona de servicio y disponibilidad en el POS

Objetivo: que el horario por bloque de la persona de servicio funcione y que el POS ofrezca disponibilidad respetando el horario de la tienda. Rama `fix/reservas-horario-proveedor` desde `origin/develop`. Entrega: commits locales por unidad, sin push ni PR. Runner: `npm run test:path -w apps/backend -- <ruta>` (una ruta por invocación). Modelos por rol: `sopus` (explorador y escritor `sonnet`; verificador el grande).

## Specs

**Historia:** Como dueño de una tienda de servicios en el admin y el POS de Vendix, quiero que el horario de cada persona de servicio funcione y que el POS lo respete, para poder agendar reservas sin errores falsos.

- **S1 — Horario en el bloque de la persona de servicio.** Usuario: "el horario en ble bloque de persona de servicio no esta funcionado". El horario configurado en el bloque de la persona de servicio se guarda y se vuelve a ver igual al reabrir.
- **S2 — POS: "el servicio no tiene horario".** Usuario: "cuando vamos hacer una reserva desde el pos dice que el servicio no tiene horario". Con el horario de la tienda configurado, reservar un servicio desde el POS no debe mostrar ese error.
- **S3 — POS: "no hay ninguna persona de servicio".** Usuario: "si configuramos los horarios del persona de servicio en un bloque si guarda en el pos dice que no hay ninguna persona de servicio". Con una persona de servicio con horario dentro del horario de la tienda, el POS la ofrece para reservar.
- **S4 — Horario base.** Usuario: "el hrario del servicio depende edel horario configurado de la tiene en configuraciones". El horario del servicio sale del horario de la tienda en Configuración (supuesto: la persona de servicio solo puede acotarlo, no ampliarlo; por confirmar con el mapa).

Pasos para reproducir (inferidos): 1) Configuración → horario de la tienda. 2) Reservas → servicio + persona de servicio → horario por bloque → guardar. 3) POS → reservar el servicio → ver el error.

## Tasks

| ID | Specs | Tarea | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- | --- |
| T0 | S1–S4 | Mapa del flujo de disponibilidad (explorador `sonnet`, Mapping trigger: flujo desconocido que cruza settings, servicios, proveedores y POS) | delegado | hecho | — |
| T1 | S1 | Migración que borra el índice único heredado (provider_id, day_of_week) | inline | hecho; RED/GREEN en DB temporal | 0b9a98e1a |
| T2 | S2, S3 | POS sin horarios / sin persona de servicio tras el fix | inline | pendiente: confirmar en prod tras el deploy (asignación persona↔servicio "test") | — |

## Log

- L1 (2026-11-04, usuario): "crea una rama nueva desde develop la cual es para solucionar bug de modulo de reserva el horario en ble bloque de persona de servicio no esta funcionado y cuando vamos hacer una reserva desde el pos dice que el servicio no tiene horario  y si configuramos los horarios del persona de servicio en un bloque si guarda en el pos dice que no hay ninguna persona de servicio el hrario del servicio depende edel horario configurado de la tiene en configuraciones" / "usa la @skills/sopus/".
- L2: rama creada desde `origin/develop` (`e918bb983`). Mirror Engram pendiente (herramienta no disponible en la sesión).
- L3 (2026-11-04): T0 hecho (explorador sonnet: el contrato editor↔DTO cuadra; disponibilidad = horario de tienda (settings.pos.business_hours) ∩ bloques de la persona; sin hallazgo estático). Repro por API en tech-bogota: empleado 4 + proveedor 4 + servicio 833 + horario jueves 08-12/14-18 → `GET availability/833` 2026-11-05 devuelve slots 09:00… con el proveedor y `for-service` lo lista. Backend OK. Nike (tienda 10): proveedor 1 (servicio 967) con bloques dom–vie, sin sábado; horario tienda completo. No reproducido aún: falta la pantalla exacta (Playwright MCP sin conexión).
- L4 (2026-11-04, usuario): "publica la rama y has la misma prueba en produccion … depronto mi local esta desactualizad" → plan aprobado, solo lectura en prod. Rama publicada (`03672d5de`). origin/main = origin/develop (0 commits de diferencia). Prod `tech-bogota` (solo login + GET): `pos.business_hours` completo (lun–dom), `availability.working_days` [1..5]; 0 personas de servicio; la consulta de productos tipo servicio devolvió 0. No reproducible en prod con solo lectura: la tienda no tiene personas de servicio.
- L5 (2026-11-04, usuario): capturas de prod (vendix.online, Nike): con dos bloques por día (8–12, 2–6) → "Los bloques del horario están duplicados o tienen un formato inválido. Revisa los bloques de cada día e inténtalo de nuevo."; con un bloque (9–6) → "Horario guardado"; POS "Agendar test" (2m por cita) → "No hay horarios disponibles para este día." / "actuliza mi local depronto esta desactualizado" / "cambiate a la rama de reseva".
- L6: causa S1 verificada: `20260328160000_provider_first_scheduling` crea `provider_schedules_provider_id_day_of_week_key` con CREATE UNIQUE INDEX; `20260719000000_add_multi_block_schedules` solo lo borra si aparece en information_schema.table_constraints (no lista índices sueltos) → sobrevive y el segundo bloque del día da P2002 → 400 de `provider-schedule.service.ts`. RED: replay de ambas migraciones en DB temporal `vx_probe_ix` → INSERT de dos bloques el mismo día falla con ese índice. GREEN: + migración 20261111090000 (dos veces) → índice eliminado, dos bloques insertan, duplicado real (día, block_order) sigue rechazado. DB temporal borrada. Local ya no tenía el índice (no-op). Local = prod en código (origin/main y origin/develop con árbol idéntico).
- L7: verificador independiente (grande): S1 pasa; 4 variantes en DBs temporales `vx_verify_*` (índice heredado, constraint, constraint sin la migración de julio, ninguno) → índice heredado eliminado, dos bloques insertan, duplicado rechazado; ninguna dependencia del nombre en código, scripts ni CI. Advisory: fecha 20261111 se mantiene (QUI-979 usa 20261110; el repo ya usa fechas adelantadas).
- L8 (2026-11-04, usuario): "prácticamente era que en producción no guardaban los bloques de horario y si lo guardamos por un solo bloque el sistema no lo estaba leyendo … verifica eso también". Local (mismo código que prod, contenedor en UTC igual que prod): persona 4 con un bloque lun–vie 09–18 → miércoles 04/11 desde 13:30 (9 slots), jueves 18, sábado 0; con duración 2 min → 144 / 270 slots. El horario de un bloque se lee bien en código; en prod la diferencia sería de datos (asignación persona↔servicio "test", servicio con estación, persona inactiva). Falta lectura de prod en Nike.
