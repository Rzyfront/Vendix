# Execution Log

| Date | Who | Step | Event | Evidence |
|------|-----|------|-------|----------|
| 2026-09-11 | orquestador | A.1 | Matriz repro lanzada (1 agente); baseline: backend/redis/postgres Up, invoice-line-math.spec.ts existe | checkpoint/parallel-cp-facturacion-redondeo |
| 2026-09-11 | orquestador | A.1 | Cerrado: 36 fallos nuevos previstos, 111 vigentes verdes; commit 65364f31e | evidence/A.1-regression-spec.log + evidence/A.1-calculator-spec.log |
| 2026-09-11 | orquestador | A.1 | Evidencia copiada al bundle (evidence/A.1-*.log) | evidence/A.1-regression-spec.log |
| 2026-09-11 | orquestador | A.2+A.3 | Fan-out 3 agentes paralelos (motor / espejo-checkout / frontend-renders), scopes disjuntos | steps/A.2, steps/A.3 |
| 2026-09-11 | orquestador | A.2 | Cerrado: kernel 33, motor 115, espejo 41, gate 3, AIU 5, tax-matrix 36; commits 8ae35188a+f73eb42f0 | suites A.2 |
| 2026-09-11 | orquestador | A.3 | Cerrado con nota: kernel probado por exactitud, renders 34/34; specs FE sin runner local | real-print-path 34/34 |
