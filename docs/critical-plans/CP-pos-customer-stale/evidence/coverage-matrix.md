# Matriz Happy/Sad/Brute (how-to-test) — CP-pos-customer-stale

## Verificado (estático + lógica + auditoría)
| Flujo | Happy | Sad | Brute | Mecanismo | Evidencia |
|---|---|---|---|---|---|
| A-luego-B resuelve B | PASS 5/5 | — | — | probe espejo post-change | evidence/post-change-probe.txt |
| F-002/F-003/F-004 | PASS 4/4 | — | — | probe espejo r2 | evidence/post-change-probe-r2.txt |
| Guard compila | PASS | — | — | tsc util (root binary) | evidence/static-checks.txt |
| Sin regresión zoneless en scope | 0 menciones | — | — | zoneless-audit.sh | evidence/static-checks.txt |
| 13 perspectivas R1-R4 | convergencia blocker/major limpia R3+R4 | — | — | agent-teams audit | log/convergence.md, findings/ |
| Regresión colateral hosts no tocados | clean R2 | — | — | audit solo-lectura | ronda 2 (r2-regression) |

## BLOQUEADO por entorno (no verificado, no afirmado)
| Flujo | Falta | Desbloqueo |
|---|---|---|
| Karma spec guard (12 casos) | `ng test` prohibido por buildcheck-dev + sin browser aquí | CI al abrir PR, o `ng test` local del dev |
| curl Happy/Sad/Brute FB-01+ERR | backend en boot-loop (OOM), `/api/health` → 000 | estabilizar vendix_backend y correr comandos del registry |
| Playwright E2E A-luego-B en vhost | ng serve CAÍDO (RANCIO) + sin MCP Playwright aquí | `npm run dev:fe`, vhost https://vendix.com, receta en E.1 |
| pr-code-review ≥80% | gate pre-merge | al abrir PR contra develop |

Nada de lo bloqueado se marca verde en registries ni checklists.
