# Evidencia — matriz E2E local (2026-09-08, tienda 10 Roku)

## Happy ✅

- API quote Riohacha/La Guajira/440001 (item 90000): 3 opciones — id 8 Flota own_fleet 0, id 9 Personalizado custom 0, id 7 pickup 0, `is_fallback:false`. (curl)
- UI (agent-browser, roku-shop.vendix.com → local): domicilio → dirección Riohacha → "Elige el envío" lista Flota + Personalizado, ambas sin preseleccionar. Elegir Flota → Continuar → POST addresses 201 → paso Pago muestra "Test Flota propia — Gratis". (E2E)
- Modal ubicación aparece solo en domicilio con mapa listo; descartable con Escape. (E2E)

## Sad ⚠️

- API sin ciudad → `[]`; ciudad/región incoherente → tarifas de zona amplia (semántica del comerciante, sin crash). (curl)
- UI Continuar sin elegir tarifa → bloquea en paso 1 y renderiza "Por favor selecciona una opción de envío". (E2E, handler directo + DOM)
- Consola: sin errores del flujo (solo NG0505 hidratación y 403esperado de customer a /store/settings). ECOM_SALE_UNIT_001 en cart summary: config de la tienda, no bloquea.

## Brute 🔒

- API inyección SQL en city → `[]`, sin volcado; tienda 9999 → `[]`, sin fuga. (curl)
- UI guest en /checkout → rebota a carrito vacío, sin acceso ni fuga. (E2E)
- Hallazgo F-005: `POST login-customer` devuelve el hash bcrypt en `data.user.password`. No explotado; queda abierto.

## Limpieza

Direcciones de prueba 531/532/533 eliminadas (200), carrito de prueba vaciado (200), sesiones de navegador cerradas. Tarifas 8/9 en zona 5 SE CONSERVAN (son el fix de dato).
