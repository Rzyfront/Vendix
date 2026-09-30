# B.2 — claim atómico de `paid_at` y SSE (2026-09-23)

La proyección canónica leía `openSession.paid_at` antes de escribir. Dos confirmadores concurrentes podían leer `NULL`, reescribir la fecha de primer cobro y emitir dos eventos `session_paid`.

`markSessionPaid` ahora ejecuta `UPDATE ... WHERE id=:session AND store_id=:store AND paid_at IS NULL` vía `updateMany`; sólo `count=1` es dueño de la primera marca y del evento post-commit. Un perdedor lee la fila resultante sin alterar su timestamp ni emitir. La consulta raw-transaccional lleva `store_id` explícito.

Prueba roja antes del cambio: un snapshot viejo (`paid_at=NULL`) con claim perdido (`count=0`) seguía usando `update` y anunciaba sesión pagada. Tras el cambio, `table-sessions.service.spec.ts` **60/60** verde, incluyendo idempotencia, transacción externa, confirmación parcial/completa, fallo de proyección y carrera simulada. `git diff --check` limpio. Pendiente prueba de concurrencia real con fixture de mesa aislado para cerrar B.2.
