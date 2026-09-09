---
id: A.2
title: "Llevar fixes a prod por release a main"
phase: A
status: pending
owner: none
updated: 2026-09-08
contracts: [FB-01, FB-03, FB-04]
adrs: [ADR-01]
skills: [git-workflow, pr-code-review, buildcheck-dev]
---
# A.2 — Llevar fixes a prod por release a main

- **Skills:** git-workflow, pr-code-review, buildcheck-dev
- **Resources:** `gh pr view 766 --json mergeStateStatus,reviewDecision` + `gh pr merge 766 --merge` (solo tras CI verde + aprobación; prohibido `--admin` sin orden explícita)
- **Business decision:** prod solo se mueve por release `develop→main` (ADR-01); el skew actual se corrige llevando ambos fixes juntos, nunca uno solo.
- **Why:** va después de A.1 porque si A.1 demuestra que el fallo es solo dato de zona, igual conviene cerrar el skew antes de retestear; si demuestra skew, este paso ES el fix.
- **Output:** PR #766 mergeado a `main`; deploys de frontend y backend ejecutados en verde.
- **Contracts touched:** FB-01 (match tolerante), FB-03/FB-04 (flag comprobante ya aprobado en el mismo release).
- **Data impact:** none — sin migraciones en el release (verificado por diff); settings JSON con defaults compatibles.
- **Blast radius:** todo el storefront y API en prod durante el deploy; ventana de CloudFront/EC2 habitual.
- **Rollback:** revert del merge commit de #766 + re-deploy; `git tag checkpoint/parallel-checkout-20260909` como ancla de develop.
- **Verification:**
  - `gh pr view 766 --json state` → MERGED; runs deploy-s3 y deploy-backend-ec2 en SUCCESS sobre el merge
  - El string de cobertura y el match tolerante responden en prod (repetir FB-01 contra api.vendix.com)
- **Acceptance checklist:**
  - [ ] CI del PR en verde y aprobación registrada (sin bypass)
  - [ ] Merge a `main` + ambos deploys SUCCESS con evidencia en `evidence/`
- **Status:** pending
