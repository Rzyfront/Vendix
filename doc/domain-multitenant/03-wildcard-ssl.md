## 3) ¿Qué es un wildcard y cómo usarlo para SSL en dominios/subdominios? ¿Sirve para desarrollo local?

Concepto
- Un certificado wildcard (comodín) cubre todos los subdominios de un dominio concreto. P. ej. un certificado para `*.vendix.com` cubre `app.vendix.com`, `www.vendix.com`, `foo.vendix.com`, pero no `vendix.com` (para eso suele necesitarse un SAN que incluya el root `vendix.com`).

Ventajas
- Menos certificados a gestionar (uno para muchos subdominios).
- Sencillo para entornos donde controlas todos los subdominios del dominio principal.

Limitaciones
- No cubre dominios completamente distintos (p. ej. `myshop.com`).
- Let’s Encrypt permite wildcard certs pero exige DNS-01 challenge (requiere control del DNS para poner un TXT record), no HTTP-01.

Uso en producción
- Emite un wildcard para `*.vendix.com` (y opcionalmente incluir `vendix.com` en SANs) via ACME (certbot con DNS plugin, o Traefik/Caddy automáticos).

Uso en desarrollo local
- Un wildcard público no es práctico para `localhost` ni para dominios arbitrarios que simulas localmente. Opciones:
  - Generar una CA local (intermedia) y firmar un wildcard para `*.dev.local`. Añadir la CA al store de confianza local (recomendado solo en entornos controlados).
  - Usar certificados autofirmados para cada host (requiere añadir excepciones en el navegador o añadir el CA).
  - Usar `lvh.me`/`localtest.me` con certificados autofirmados si necesitas HTTPS local.

Emisión con Let's Encrypt (DNS-01) — ejemplo conceptual
1. Tener acceso al proveedor DNS (API) o usar un DNS plugin de certbot.
2. Ejecutar: `certbot certonly --dns-cloudflare --dns-cloudflare-credentials ~/.secrets/cloudflare.ini -d "*.vendix.com" -d vendix.com`
3. Configurar Nginx para usar los archivos generados.

Recomendaciones
- En producción usar ACME automatizado con Traefik/Caddy o certbot DNS plugin.
- En local, usa una CA local o lvh.me para agilizar pruebas.
- Para dominios de clientes usa certificados por dominio (no wildcard) o automatiza issuance con Traefik/Caddy.

---
