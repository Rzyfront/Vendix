## 1) Registrar subdominios en Nginx para desarrollo (local)

Objetivo
- Poder probar múltiples subdominios en tu máquina local sin editar/añadir manualmente entradas para cada host en `/etc/hosts`.

Opciones (ordenadas por sencillez)
- lvh.me / localtest.me / nip.io: servicios que resuelven cualquier subdominio hacia `127.0.0.1`. Ejemplo: `anything.lvh.me` apunta a `127.0.0.1`.
- dnsmasq: levantar un servidor DNS local que resuelva `*.dev.local` hacia `127.0.0.1` (más control, recomendado cuando necesitas muchos dominios).

Ejemplo rápido con lvh.me (rápido y sin instalación)
1. Accede a `http://mytenant.lvh.me:4200` y `http://other.lvh.me:4200` — ambos resuelven a `127.0.0.1`.
2. Configura Nginx para aceptar subdominios de lvh.me:

```nginx
server {
  listen 80;
  server_name .lvh.me; # acepta any-subdomain.lvh.me

  location / {
    proxy_pass http://localhost:4200; # tu dev server (ng serve)
    proxy_set_header Host $host; # passthrough del Host
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Alternativa: dnsmasq (más control)
1. Instalar dnsmasq y configurarlo para resolver `*.dev.local` a `127.0.0.1`.
2. Configurar NetworkManager o /etc/resolv.conf para usar `127.0.0.1` como servidor DNS.
3. Crear un bloque nginx con `server_name ~^(?<subdomain>.+)\.dev\.local$;` y usar `$subdomain` si hiciera falta.

Recomendaciones
- Usa lvh.me para pruebas rápidas. Usa dnsmasq cuando necesites un entorno consistente entre miembros del equipo.
- Para HTTPS local puedes usar un certificado autofirmado o una CA local (ver sección de wildcard y certificados a continuación).

Limitaciones
- No puedes usar un wildcard en `/etc/hosts`. Para wildcard necesitas dnsmasq o servicios externos tipo nip.io/lvh.me.

---
