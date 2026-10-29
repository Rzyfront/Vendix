# Planes Vendix

Precios vigentes al 2026-09-06 (respaldo de la landing en producción: `apps/frontend/src/app/public/landing/vendix-landing/vendix-landing.component.ts`, `useCuratedFallbackPlans` y `COMPARISON_ROWS`). La fuente de verdad es la API pública `GET https://vendix.online/api/public/plans`; confírmalos con quien pide el documento antes de emitir.

La suscripción es un servicio en la nube con IVA del 0%.

| Plan (código) | Mensual | Trimestral | Anual |
|---|---|---|---|
| Vendix Impulsa (`vendix-impulsa`) | $49.900 | $142.200 | $538.900 |
| Emprendedor Pro (`emprendedor-pro`) | $69.900 | $199.000 | $749.000 |
| Empresarial Pro (`empresarial-pro`) | $89.900 | $259.000 | $969.000 |
| IA Business (`ia-business`) | $179.900 | $512.900 | $1.942.900 |

## Qué diferencia a cada plan

| | Impulsa | Emprendedor Pro | Empresarial Pro | IA Business |
|---|---|---|---|---|
| Usuarios | 1 | Ilimitados | Ilimitados | Ilimitados |
| Industrias | 1 | Ilimitadas y combinadas | Ilimitadas y combinadas | Ilimitadas y combinadas |
| Productos, POS, tienda en línea, inventario, compras, reportes | Ilimitados | Ilimitados | Ilimitados | Ilimitados |
| Comisión por venta | 0% | 0% | 0% | 0% |
| Facturación electrónica DIAN | No | No | Sí | Sí |
| Nómina electrónica y documento soporte | No | No | Sí | Sí |
| Contabilidad automatizada | No | No | Sí | Sí |
| Vexi IA | Límites de prueba | Extendidos | Extendidos | ×100 frente a Impulsa |
| IA Tools e IA Agents | No | No | No | Sí |

## Reglas para la propuesta

- Si el cliente necesita facturar electrónicamente, el plan mínimo es Empresarial Pro. Si eligen un plan sin facturación, dilo en las condiciones.
- Si el negocio combina varias industrias (hotel + restaurante, por ejemplo), Impulsa no sirve: solo admite una industria y un usuario.
- Con facturación electrónica, añade en condiciones que la habilitación ante la DIAN requiere la resolución de numeración y el certificado digital del cliente.
- Condiciones fijas de Vendix: sesión inicial de puesta en marcha gratuita; implementación adicional a $40.000 COP por hora, IVA incluido, acordada antes de cada sesión.
