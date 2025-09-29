## 5) Cómo hacer SSL dinámico para dominios propios de clientes

Opciones principales
- Traefik / Caddy (recomendado): manejo automático de TLS y ACME por host.
- Nginx + Certbot (manual o automatizado por DNS API): gestionar issuance por dominio y recargar nginx.

Opción A — Traefik (alto grado de automatización)
1. Levanta Traefik en front junto a Docker (traefik se encarga de routing por host y obtención ACME).
2. Cuando el cliente añade un dominio y apunta DNS a tu IP, Traefik detecta el Host y solicita Let’s Encrypt para ese host.
3. Traefik renueva automáticamente los certificados.

Ventajas Traefik
- Sin recargas manuales de nginx.
- ACME automático (HTTP-01 o DNS-01 según configuración).

Opción B — Nginx + certbot (control manual / semi-automático)
1. Tras verificación de ownership y confirmación de que el dominio apunta a tu IP, ejecuta certbot para ese dominio.
   - Si Let’s Encrypt no puede usar HTTP-01 (por ejemplo, si no quieres exponer puertos), usa DNS-01 con plugin del proveedor.
2. Guardar certificados en `/etc/ssl/live/<domain>` y crear un `server` block en nginx que use esos certificados.
3. Recargar nginx (`nginx -s reload`).

Automatización segura (recomendado)
- Implementa un worker que:
  1. Detecte `domain.active` en DB.
  2. Compruebe que el dominio resuelva a tu IP (A record). Si no, marcar `waiting_dns`.
  3. Llamar a ACME issuance (via Traefik o certbot DNS plugin).
  4. Si éxito, actualizar DB con `sslStatus=active` y emitir evento.

Problemas comunes
- Let’s Encrypt limita requests; implementa backoff y retries.
- Para dominios que no quieren apuntar su A (usando CNAME o proxys), necesitarás soluciones DNS-01 o pedir delegación.

Recomendación práctica
- Si vas a gestionar dominios de clientes en forma masiva, usa Traefik/Caddy. Son los más sencillos de operar y evitan reconfigurar nginx manualmente.

---
