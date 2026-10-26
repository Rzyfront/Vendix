# buildcheck runner and memory budget

Only for the two exceptions in SKILL.md (explicit build request, or confirmed release prep).

## Commands (`scripts/buildcheck.sh`)

| Need | Command | What it runs |
| --- | --- | --- |
| Both apps | `npm run buildcheck` | backend `tsc --noEmit` + frontend `ngc` typecheck |
| Backend only | `npm run buildcheck:be` | `tsc -p apps/backend/tsconfig.build.json --noEmit` |
| Frontend only | `npm run buildcheck:fe` | `ngc -p apps/frontend/tsconfig.buildcheck.json` (AOT + `strictTemplates`, no bundle) |
| One spec (allowed in dev) | `npm run buildcheck:test -- src/.../x.spec.ts` | that spec, `--runInBand` |
| Whole backend suite (CI only) | `npm run buildcheck:test` | every spec, hours |
| Full bundle (release) | `npm run buildcheck:deep` | `ng build --configuration buildcheck`, no prerender/SSR |
| Sweep orphans of a killed run | `npm run buildcheck:reap` | TERMs orphan `ng serve`/`ng build`/prerender/`nest start`/`jest-worker` |
| Diagnose a memory spike | `npm run buildcheck:top` | every `node` process >300 MB with its command line, plus the Docker VM |

Runner properties: never serves, watches or prerenders; each step in its own process group, killed on
exit/timeout/Ctrl-C; timeout `BUILDCHECK_TIMEOUT` (900 s); RAM caps `BUILDCHECK_BE_MEM` 3072 MB,
`BUILDCHECK_FE_MEM` 4096 MB; steps run sequentially on purpose; logs in `.buildcheck/<step>.log`;
backend typecheck is incremental (~85 s cold); a RAM preflight aborts before spawning (override only
knowingly with `--force`).

## Shared log path: do not trust `.buildcheck/`

Several agents may share the tree, so a PASS in `.buildcheck/<step>.log` may belong to another run.
Distrust it if total time equals `BUILDCHECK_TIMEOUT` (wrapper hung on an orphan) or the tail is
identical to the previous report. Run with a private log and read the exit code:

```bash
LOG=/tmp/buildcheck-$$-fe.log
date -u +"start %Y-%m-%dT%H:%M:%SZ"
npm run buildcheck:fe > "$LOG" 2>&1; echo "exit=$?"
date -u +"end   %Y-%m-%dT%H:%M:%SZ"
tail -12 "$LOG"
```

Report the HEAD hash taken in the same shell call, UTC start/end, and that the tree was final. Before
a push, re-check `git rev-parse HEAD` against the audited SHA.

## Memory budget (16 GB, 10 cores)

- Colima VM (db, redis, backend, nginx): 6 GiB reserved. Native `ng serve`: ~4-5 GB warm. Real free
  budget with the stack up: ~4 GB.
- Jest is capped in `apps/backend/package.json` (`maxWorkers: 2`, `workerIdleMemoryLimit: "1024MB"`);
  uncapped it spawns 9 ts-jest workers (~2.5 GB each). Never raise these locally.
- Never two heavy Node steps at once. `NG_BUILD_MAX_WORKERS=2` for the deep bundle.
- Preflight aborts → free RAM first: `pkill -f 'ng serve'`, or `docker compose stop`.
- After any killed run: `npm run buildcheck:reap`. Consecutive PIDs with identical RSS in
  `buildcheck:top` = a worker pool (`cores - 1` is Jest's default).
