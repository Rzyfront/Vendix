# Evidencia — versión de código bajo prueba (corrección 2026-09-08)

Corrección del usuario: las pruebas fueron en LOCAL (vhost vendix.com → local), no en prod. F-001 queda refutado.

- Frontend local: `develop` (incluye 93365bc55: mensaje nuevo + `shippableOptions`; verificado `ng serve ACTIVO, último ciclo OK` vía `scripts/buildcheck.sh --watch`).
- Backend local: `develop` en `vendix_backend` (Up 9h); incluye 61a5a6f55 salvo que el watch no haya recompilado (verificación pendiente en A.1 si el dato no explica todo; con el snapshot actual el dato sí lo explica).
- Deploys prod (`deploy-s3.yml`, `deploy-backend-ec2.yml`): solo en push a `main`; PR #766 sigue abierto → prod NO tiene ninguno de los fixes.
- Reproducción local del request anotado: idéntica respuesta `[pickup zone_id:5 is_fallback:false]` (ver F-002 y `zonas-tienda-10.md`).
