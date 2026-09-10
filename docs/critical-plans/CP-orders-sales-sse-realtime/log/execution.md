# Execution Log

| Date | Who | Step | Event | Evidence |
|------|-----|------|-------|----------|
| 2026-09-10 | Rafael | A.1 | 4 emisores order.created confirmados (POS, checkout x2, pagos) | evidence/a1-emitters.log |
| 2026-09-10 | Rafael | A.2 | Stream exige store:orders:read; curl bloqueado (dev apagado, http 000) | evidence/a2-matrix.log |
| 2026-09-10 | Rafael | B.1 | Servicio acepta order.created; spec 13/13 SUCCESS (harness globalThis) | evidence/c1-karma-sse.log |
| 2026-09-10 | Rafael | B.2 | Prepend+dedup+filtros+toast+statsChanged en lista y padre; E2E pendiente | codigo en rama feature/orders-sales-sse-realtime |
| 2026-09-10 | Rafael | TREE | Pop ajeno revertido (51 archivos print-formats/fiscal); stash@{0} intacto | git status limpio, solo 4 archivos propios |
