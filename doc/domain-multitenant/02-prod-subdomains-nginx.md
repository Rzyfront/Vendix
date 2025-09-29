## 2) Registrar subdominios y routing en Nginx para producción

Objetivo
- Atender múltiples hosts (subdominios y dominios personalizados) y enrutar a frontend/backend según el Host.

Requisitos previos
- Acceso al DNS del dominio (para crear A/ALIAS records).
- Un servidor con IP pública donde correr Nginx (o usar un proxy dinámico como Traefik/Caddy).

Flujo general
1. En DNS, crea un registro `A` (o ALIAS) que apunte `vendix.com` y `*.vendix.com` hacia la IP del servidor. Para proveedores que no soporten wildcard en A, pide a los clientes crear subdominios específicos.
2. En el servidor Nginx crea bloques `server`:
   - Uno para `vendix.com` y `*.vendix.com` que proxyee al frontend.
   - Otro para `api.vendix.com` que proxyee al backend.

Ejemplo (nginx.conf):

```nginx
upstream vendix_frontend { server frontend:4200; }
upstream vendix_backend { server backend:3000; }

server {
  listen 443 ssl;
  server_name vendix.com *.vendix.com;
  ssl_certificate /etc/ssl/certs/wildcard_vendix_com.pem;
  ssl_certificate_key /etc/ssl/certs/wildcard_vendix_com.key;

  location /api/ {
    proxy_pass http://vendix_backend/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://vendix_frontend;
    proxy_set_header Host $host;
  }
}

server {
  listen 443 ssl;
  server_name api.vendix.com;
  ssl_certificate /etc/ssl/certs/wildcard_vendix_com.pem;
  ssl_certificate_key /etc/ssl/certs/wildcard_vendix_com.key;

  location / { proxy_pass http://vendix_backend; }
}
```

Notas
- Si el proveedor DNS soporta wildcards (`*.vendix.com`) puedes emitir un certificado wildcard y no necesitar emitir uno por subdominio.
- Para dominios personalizados de clientes (different domain), el cliente debe crear un A/ALIAS apuntando a tu IP; nginx recibirá la petición por Host y la atenderá si tienes un `server_name` que la capture (o un catch-all).

Limitaciones y recomendaciones
- Si vas a administrar cientos de dominios personalizados, considera usar Traefik/Caddy para automatizar TLS y routing.
- Mantén reglas de seguridad y WAF si expones paneles de administración.

---
