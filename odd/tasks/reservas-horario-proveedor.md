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
| T0 | S1–S4 | Mapa del flujo de disponibilidad (explorador `sonnet`, Mapping trigger: flujo desconocido que cruza settings, servicios, proveedores y POS) | delegado | en curso | — |
| T1 | por definir tras T0 | Reproducir y corregir | por definir | pendiente | — |

## Log

- L1 (2026-11-04, usuario): "crea una rama nueva desde develop la cual es para solucionar bug de modulo de reserva el horario en ble bloque de persona de servicio no esta funcionado y cuando vamos hacer una reserva desde el pos dice que el servicio no tiene horario  y si configuramos los horarios del persona de servicio en un bloque si guarda en el pos dice que no hay ninguna persona de servicio el hrario del servicio depende edel horario configurado de la tiene en configuraciones" / "usa la @skills/sopus/".
- L2: rama creada desde `origin/develop` (`e918bb983`). Mirror Engram pendiente (herramienta no disponible en la sesión).
- L3 (2026-11-04): T0 hecho (explorador sonnet: el contrato editor↔DTO cuadra; disponibilidad = horario de tienda (settings.pos.business_hours) ∩ bloques de la persona; sin hallazgo estático). Repro por API en tech-bogota: empleado 4 + proveedor 4 + servicio 833 + horario jueves 08-12/14-18 → `GET availability/833` 2026-11-05 devuelve slots 09:00… con el proveedor y `for-service` lo lista. Backend OK. Nike (tienda 10): proveedor 1 (servicio 967) con bloques dom–vie, sin sábado; horario tienda completo. No reproducido aún: falta la pantalla exacta (Playwright MCP sin conexión).
- L4 (2026-11-04, usuario): "publica la rama y has la misma prueba en produccion … depronto mi local esta desactualizad" → plan aprobado, solo lectura en prod. Rama publicada (`03672d5de`). origin/main = origin/develop (0 commits de diferencia). Prod `tech-bogota` (solo login + GET): `pos.business_hours` completo (lun–dom), `availability.working_days` [1..5]; 0 personas de servicio; la consulta de productos tipo servicio devolvió 0. No reproducible en prod con solo lectura: la tienda no tiene personas de servicio.
