# Evidence — D.3 Catálogo público tokenizado + safeguards (2026-09-17)

## Specs

- `catalog.service.spec.ts`: 10 nuevos D.3 en verde (where AND×OR, cap-4 path,
  legacy verbatim, scan-cap fail-open, min-length, sin-search, tenant 404,
  caché hit/miss+llave, allowlist pin 34 keys).
- `domain-resolver.middleware.spec.ts`: 12 en verde (válido, abc/0/-1/3.5/1e3/
  0x10/inyección/espacios→400, array→400, ausente/vacío→hostname, early-exit,
  isValidTenantId incl. MAX_SAFE_INTEGER).
- `http-exception.filter.spec.ts`: 2 en verde (429 fábrica→RATE_LIMIT_001,
  429 dominio intacto).
- Pre-existentes rotos en HEAD (NO causados por D.3, verificado vía stash):
  2× `attaches active_promotion…` — mocks viejos vs StorefrontPriceService
  del plan fiscal (3689d5179/888c022d9 vs spec 816267f3f). Mismo fallo con y
  sin este cambio; fix corresponde al dueño fiscal, fuera de scope.

## Vivo (dev, store 10, l1:true)

- `search=cafe` → 200, total 1 [286], applied [cafe], trunc false.
  (334 excluido: available_for_ecommerce=false + is_sellable=false — correcto.)
- `search=cafe sello` → total 0 (AND correcto: único visible carece de sello).
- 6 tokens → applied 4 ([cafe,oster,doce,tazas]) + trunc true.
- Tenant: abc/0/-1 → 400 SYS_VALIDATION_001; array → 400; missing → 404
  AUTH_STORE_001; cross-store (tienda 3, search=cafe) → total 0, cero fuga.
- min-length `a` → total 0 sin scan; search 201 chars → 400.
- sort override: search+sort_by=price_asc → 200 relevancia (sin 400).
- Allowlist viva: 34 keys exactas del pin, cero costos/tax/márgenes.
- Sin search: total 45 newest intacto; best_selling intacto.
- p95 (50 req, warm): min 2ms p50 3ms p95 4ms max 16ms. Cold (miss): 12.6ms.
- Brute-force 60s single-IP: 200=40 429=3336 other=0; 429 =
  {status:429, code:RATE_LIMIT_001}; pool 1 conn activa (sano); /health 200.
  (200=40 porque la ventana ya traía ~60 del resto de la verificación.)

## Decisiones

- Throttle 100/min por IP real (mismo techo que /public/plans); storage
  in-memory del ThrottlerModule (igual que el resto de la plataforma).
- Tenant malformado → 400 directo en middleware (throw colgaría en Express 4);
  missing → 404 AUTH_STORE_001 en service (antes: 403 genérico del scopeo).
- Fail-open catalog: where base siempre legacy; rama rank deriva su where.
  Sobre scan-cap/throw ⇒ OR-frase verbatim (no AND huérfano).
- Error-handler del catálogo intacto: con clamp, el tipeo nunca 400; limpiar
  la grilla en errores de red sería peor UX (F-024 aceptación).
