# Cabeceras de seguridad en CloudFront (SEO-TECH-22)

## Qué cambia

Una Response Headers Policy (`vendix-security-headers`, definida en `security-headers-policy.json`) asociada a todos los comportamientos de la distribución. Añade a cada respuesta (apex, `www`, tiendas y assets):

| Cabecera | Valor |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000` (sin `includeSubDomains`, sin `preload`) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

Todas con `Override: true`, para que no dependan de lo que devuelva S3. No cambia la app, el DNS, los certificados ni S3.

## Qué queda fuera y por qué

- **X-Frame-Options / `frame-ancestors`**: las tiendas pueden embeberse (QR de mesa, widgets) y el checkout de Wompi usa iframes. Un valor mal puesto rompe esos flujos. Se hará con la CSP, medida antes.
- **Content-Security-Policy**: la lista de orígenes (Wompi, Google Tag Manager, fuentes, mapas, S3 de imágenes) está inferida del código, no medida en un navegador. Debe ir primero como `Content-Security-Policy-Report-Only` (ver propuesta en `seg/evidencias/cabeceras-seguridad-TECH-22-2026-10-27.md`).
- **Permissions-Policy**: depende de la misma validación (cámara, micrófono, geolocalización, pagos).

## Riesgos

- **HSTS es difícil de revertir.** Una vez que un navegador lo recibe, fuerza HTTPS durante todo el `max-age` (1 año), aunque quites la cabecera. Hacer rollback de la distribución no lo borra en los navegadores que ya visitaron el sitio. Por eso esta fase usa solo HTTPS en el host que responde: sin `includeSubDomains` (no obliga a HTTPS en subdominios que no controlamos) y sin `preload` (la lista de preload es prácticamente irreversible).
- **Tiendas con dominio propio.** Si una tienda con dominio propio pasa por esta distribución, también recibirá HSTS de 1 año **para su dominio**. Comprobar que ese dominio tiene certificado válido y se renueva solo.
- **Asociación a todos los comportamientos.** El script aborta sin cambios si algún comportamiento ya tiene otra Response Headers Policy.
- El despliegue de CloudFront tarda de 3 a 15 min; el rollback tarda lo mismo.
- No se había comprobado si la distribución de dominios propios (`E3I95HVZBIX74T`, según el runbook de TECH-03) comparte el origen: si hay que cubrirla, se corre el script otra vez con `DIST_ID=E3I95HVZBIX74T`.

## Plan para subir HSTS después

1. Aplicar tal cual (1 año, sin subdominios, sin preload) y vigilar 2-4 semanas: sin quejas de certificados ni de contenido mixto.
2. Confirmar que **todos** los `*.vendix.online` (paneles, tiendas, api) sirven HTTPS válido. `curl -sI https://<sub>.vendix.online` en cada uno.
3. Poner `"IncludeSubdomains": true` en `security-headers-policy.json` (el validador de `test` lo rechaza hoy: ajustar esa comprobación en el mismo cambio) y correr `apply` otra vez; actualiza la policy y no cambia las asociaciones.
4. Solo si se decide entrar en la lista de preload (hstspreload.org): `"Preload": true` y `max-age` ≥ 31536000, con `includeSubDomains` obligatorio. Es una decisión de Rafa.

## Pasos para Rafa

Requiere AWS CLI con permisos `cloudfront:*ResponseHeadersPolicy*`, `GetDistributionConfig` y `UpdateDistribution`. Desde `infra/cloudfront`:

```bash
./apply-security-headers.sh test        # valida el JSON; no usa AWS
./apply-security-headers.sh baseline    # guarda las cabeceras actuales
./apply-security-headers.sh apply       # crea la policy, respalda y asocia; espera el despliegue
./apply-security-headers.sh verify      # compara contra la línea base
# solo si algo sale mal:
./apply-security-headers.sh rollback    # restaura el último respaldo de la distribución
```

Variables opcionales: `DIST_ID` (por defecto `E1I27OYFJX7VYJ`) y `HOSTS` (por ejemplo `HOSTS="vendix.online www.vendix.online vendix-pit-and-grill-shop.vendix.online"`). Los respaldos quedan en `.work/` (ignorado por git).

## Verificación con curl

```bash
for u in https://vendix.online/ https://www.vendix.online/ https://vendix-pit-and-grill-shop.vendix.online/; do
  echo "== $u"; curl -sI "$u" | grep -iE '^(strict-transport-security|x-content-type-options|referrer-policy)'
done
curl -sI https://vendix.online/ | grep -i strict-transport-security   # max-age=31536000, sin includeSubDomains
node docs/seo/herramientas/seo-smoke.cjs https://vendix.online          # bloque [seguridad]
```

Revisar también a mano que el checkout (Wompi) y la carga de imágenes de las tiendas sigan funcionando. La API (`api.vendix.online`, nginx/Express) no pasa por CloudFront y se trata aparte.
