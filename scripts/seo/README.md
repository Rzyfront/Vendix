# Smoke SEO y auditoría de redirecciones

Herramientas de solo lectura, Node 20+ sin dependencias.

## seo-smoke.cjs

Sondea una URL pública (landing o tienda) y reporta OK / FALLA / AVISO por control: redirección http→https y alias www, status real (200 en rutas conocidas, 404 en desconocidas), canonical, robots, H1 y texto sin JavaScript, `robots.txt`, `sitemap.xml`, cabeceras de seguridad y caché. `x-frame-options` y `content-security-policy` ausentes dan AVISO, no FALLA: se omiten a propósito para no romper el checkout de Wompi ni las tiendas embebidas (ver `infra/cloudfront/README-security-headers.md`).

Controles con id (solo `vendix.online` los dos primeros):

| id | Comprueba |
|---|---|
| `www-apex` | `www.vendix.online` responde 301 a `https://vendix.online/` en un salto |
| `precios-pricing` | `/precios` responde 301 a `/pricing` |
| `archivo-404` | `/no-existe-<ts>.js` responde 404 (no soft 404) |
| `robots-200`, `sitemap-200` | `robots.txt` y `sitemap.xml` responden 200 |
| `sitemap-hosts` | el sitemap no lista hosts ajenos (extra: `SEO_SMOKE_ALLOWED_HOSTS=a.com,b.com`) |
| `sitemap-tokens` | el sitemap no lista URL con token (pedido, order, factura); no se piden ni se imprimen |
| `http-https` | `http://<host>/` responde 301/308 a https |
| `hsts`, `nosniff`, `referrer-policy` | la portada trae `Strict-Transport-Security`, `X-Content-Type-Options: nosniff` y `Referrer-Policy` |

### Correr

```
node scripts/seo/seo-smoke.cjs https://vendix.online --json out/smoke.json
node scripts/seo/seo-smoke.cjs https://vendix-pit-and-grill-shop.vendix.online --mode report
```

El JSON trae, por petición: `url`, `httpStatus`, `location`, `ms`, `bytes`, `ok`, `bodyHash` (sha256 del cuerpo).

## Modo report / enforce

- `report` (por defecto): imprime las FALLA pero sale con 0.
- `enforce`: sale con 1 si hay alguna FALLA.
- Se elige con `--mode` o `SEO_SMOKE_MODE`. En CI, con la variable de repositorio `SEO_SMOKE_MODE` o el input del `workflow_dispatch`.
- Para volver bloqueantes solo algunos controles: `SEO_SMOKE_ENFORCE=www-apex,precios-pricing` (con modo global `report`).

### Pasar a enforce

1. Revisar en el artefacto (retención 30 días) que los controles estén en OK de forma sostenida.
2. Gradual: poner la variable `SEO_SMOKE_ENFORCE` en el workflow con los ids estables.
3. Total: crear la variable de repositorio `SEO_SMOKE_MODE=enforce`. Los controles legacy (soft 404 de rutas desconocidas) fallan hoy en producción, así que conviene corregirlos antes.

El workflow `.github/workflows/seo-smoke.yml` corre cada 6 h y bajo demanda; no usa secretos.

### Alerta (SEO-TECH-22)

Desde el 5-nov el workflow trae `SEO_SMOKE_ENFORCE` con los controles que ya pasan en producción: `www-apex`, `precios-pricing`, `archivo-404`, `http-https`, `hsts`, `nosniff`, `referrer-policy`, `robots-200`, `sitemap-200`, `sitemap-hosts` y `sitemap-tokens`. Si alguno se rompe, el job falla y GitHub envía el correo de fallo de la corrida programada.

| Qué falla | Primer paso | Reversa |
|---|---|---|
| `www-apex`, `precios-pricing`, `archivo-404`, `http-https` | revisar la función `spa-rewrite` y la distribución en CloudFront | `infra/cloudfront/apply-spa-rewrite.sh` (baseline y rollback) |
| `hsts`, `nosniff`, `referrer-policy` | revisar la response headers policy de la distribución | `infra/cloudfront/apply-security-headers.sh` (rollback) |
| `robots-200`, `sitemap-*` | revisar el último deploy del frontend y el endpoint de sitemap | revertir el PR del deploy |

- La variable de repositorio `SEO_SMOKE_ENFORCE` reemplaza la lista sin tocar el archivo. Con `-` no bloquea ningún control.
- Retención: el JSON queda 30 días como artefacto. El repo es público, así que el reporte no lleva cookies, credenciales ni URL con token; la guardia de tokens borra los resultados si encuentra una.
- El smoke solo hace GET y HEAD anónimos. Que una página responda no prueba nada sobre permisos.

## redirects-audit.cjs

```
node scripts/seo/redirects-audit.cjs docs/seo/redirects-registry.csv
```

Lee el registro (`docs/seo/redirects-registry.csv`) y sale con 1 si encuentra: destinos vacíos, cadenas A→B→C o destinos que son a su vez origen, bucles, orígenes duplicados con destino distinto, o falta de las reglas obligatorias `www→apex` (R01) y `/precios→/pricing` (R06). Las reglas con comodín (`/*`) se avisan y quedan fuera del análisis de cadenas.

## Pruebas

```
node scripts/seo/seo-smoke.test.cjs
node scripts/seo/redirects-audit.test.cjs
```
