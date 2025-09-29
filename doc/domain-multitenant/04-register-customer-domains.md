## 4) Registrar dominios propios de clientes de forma dinámica

Flujo seguro y recomendado

1) Ownership verification (imprescindible)
- Antes de activar un dominio de cliente, verifica que el cliente controle el DNS. Opciones:
  - DNS TXT token: Genera un token (UUID) y pídele al cliente que cree un TXT record `_vendix-verify.<their-domain>` con ese token.
  - File upload (menos recomendado): pedir que coloque un archivo con token en `https://their-domain/.well-known/vendix-token.txt`.

2) API/Admin para creación
- El admin añade el dominio a `domain_settings` con estado `pending` y recibe un `verificationToken`.
- El sistema muestra instrucciones (ej: crea TXT con valor `token-abc123`).

3) Verificación automática
- Job/cron o endpoint que valide que el TXT existe (consultando DNS) o verifica el archivo en HTTP.
- Si la verificación es exitosa, cambiar el estado a `active`.

4) Provisionamiento SSL (opcionalmente automatizado)
- Si usas Traefik/Caddy: una vez el dominio apunta a tu IP y está `active`, Traefik solicitará Let’s Encrypt automáticamente.
- Si usas Nginx + certbot (manual o con DNS API): lanzar issuance ACME (DNS-01 si es wildcard o cuando el proveedor lo soporte).

5) Activación en runtime
- Una vez active, invalidar cache en backend (si cacheas `domain_settings`) y notificar al servicio de routing si aplica.
- Opcional: generar evento `domain.created` para que otros servicios reaccionen (webhooks, analytics, etc.).

Seguridad y control
- Rechaza dominios que ya estén en uso por otras organizaciones dentro de tu plataforma.
- Mantén un proceso de revocación: si el cliente elimina el dominio, revoca el certificado y elimina el registro.
- Registrar logs y auditoría (quién añadió el dominio, cuándo, verificación, IPs).

Ejemplo de endpoint (pseudocódigo)

POST /api/admin/domains
Body: { hostname, organizationId, config }

Respuesta: { id, hostname, verificationToken, instructions }

GET /api/admin/domains/:id/verify -> retorna { verified: boolean }

---
