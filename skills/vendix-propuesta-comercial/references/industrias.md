# Catálogo comercial de industrias Vendix

Fuente: `origin/main` (producción) al 2026-10-29. Solo se ofrece lo de "Hoy en producción". Lo de "Próximamente" se menciona únicamente si quien pide el documento lo autoriza, y siempre con la palabra "próximamente".

Las industrias de una tienda salen de `industry_enum` (`apps/backend/prisma/schema.prisma`) y se pueden combinar: una tienda con hotel, restaurante y pasadías usa `hospitality` + `restaurant` + `service` + `retail`. Los módulos de industria se habilitan por la industria de la tienda, no por el plan. El plan Impulsa admite una sola industria; los demás, ilimitadas y combinadas.

Para revalidar este catálogo: `git log --oneline origin/main | grep -E 'feat\((hospitality|restaurant|kitchen|tables|reservations|memberships|contracts)'` y el menú `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts`.

## Cómo detectar las industrias desde la descripción del cliente

| Señales en la descripción | Industria | Eje comercial |
|---|---|---|
| tienda, almacén, minimercado, droguería, ferretería, boutique, ropa, distribuidora, vende productos | `retail` | Ventas |
| restaurante, bar, cafetería, comidas, cocina, carta, mesas, domicilios de comida, piscina con bar | `restaurant` | Restaurante |
| hotel, hostal, cabañas, glamping, finca vacacional, alojamiento, habitaciones, "vacacional" | `hospitality` | Hotelería |
| servicios, citas, agenda, spa, peluquería, clínica, pasadías, eventos, reservas de espacios, piscina, centro recreacional | `service` | Servicios |
| gimnasio, crossfit, academia con mensualidad, membresías, socios, aforo | `gym` | Membresías |
| constructora, obras, contratos de obra, AIU, remodelaciones | `construction` | Obras y contratos |
| fábrica, producción, manufactura, transformación de materia prima | `manufacturing` | Producción |

Casi todo negocio que cobra en caja suma `retail` (Ventas) como eje. Propón entre 2 y 4 ejes y confírmalos siempre con quien pide el documento antes de generar.

## retail · Ventas

Hoy en producción:
- Punto de venta y caja, con tickets y varios métodos de pago.
- Productos con categorías, marcas, variantes, precios e impuestos.
- Inventario en varias ubicaciones: ajustes, transferencias, movimientos y números de serie.
- Compras y proveedores.
- Tienda en línea y catálogo por WhatsApp.
- Plan separe (apartado con cuotas), promociones y cupones.
- Despachos con remisiones, rutas y flota.
- Clientes, reseñas, ventas sociales y anuncios.

Próximamente: precios preferenciales por cliente; facturación automática de domicilios al entregarse y pagarse.

## restaurant · Restaurante

Hoy en producción:
- Mesas con cuenta abierta, división de cuenta y reasignación de cuentas.
- Comandas a cocina con pantallas KDS en tiempo real, por estaciones.
- Modo cocina física con impresión del ticket de cocina.
- Recetas con insumos y productos preparados; ingredientes y compras de insumos.
- Cartas y menús; carta en línea.
- QR de mesa con cartel imprimible y botón para llamar al mesero.
- Pedidos desde la tienda en línea a la mesa; producción.

Hardware típico: tablets para KDS (una por estación), impresora POS de cocina.

## hospitality · Hotelería

Hoy en producción:
- Habitaciones y tipos de habitación.
- Recepción: reservas, walk-ins, check-in y check-out.
- Rack de ocupación.
- Cuenta del huésped con cargos a la habitación, división de cuenta y depósitos.
- Tarifas, temporadas, restricciones y políticas de cancelación.
- Housekeeping por camarera y estado de habitaciones.
- Cierre del día (auditoría nocturna).
- Indicadores de ocupación, ADR y RevPAR; pickup y pronóstico; no-shows y cancelaciones por canal.
- Reporte de servicios exentos de IVA.
- Motor de reservas propio en la tienda en línea, con pago Wompi.
- Calendarios sincronizados con Airbnb y Booking (iCal), cupos y bloqueos.

Próximamente: reportes TRA (MinCIT), SIRE y Fontur; pre-check-in en línea y mensajes al huésped; Vexi cotiza y reserva habitaciones; control de llaves y encuesta de estadía.

## service · Servicios

Hoy en producción:
- Agenda de citas y reservas con calendario, prestadores y horarios.
- Reservas desde la tienda en línea.
- Servicios con variantes (duración, modalidad, precio).
- Cotizaciones y cobro con links de pago.
- Clientes y recolección de datos.

Útil para pasadías, entradas, eventos, spa, clases o alquiler de espacios.

## gym · Membresías

Hoy en producción:
- Planes de membresía y tarifas.
- Socios y miembros.
- Control de accesos y aforo.
- Cobro recurrente con punto de venta y facturación.
- Se combina con restaurante para vender batidos y snacks.

## construction · Obras y contratos

Hoy en producción:
- Cotizaciones que pasan a contrato de obra, con estados.
- Factura AIU (administración, imprevistos y utilidad) con costo directo congelado.
- Inventario de materiales, compras, proveedores y contabilidad.

## manufacturing · Producción

Hoy en producción: no tiene suite propia en el panel. Véndelo como inventario, compras, proveedores, facturación y contabilidad. No prometas órdenes de producción ni listas de materiales para esta industria.

## Transversal (todas las industrias)

- Punto de venta y caja; inventario y valuación; tienda en línea con pago Wompi.
- Clientes, reseñas, promociones, cupones y anuncios.
- Reportes y analíticas.
- Vexi, asistente con IA (con límites según el plan).
- Varias tiendas bajo una organización.
- Según plan (Empresarial Pro e IA Business): facturación electrónica DIAN, nómina electrónica, documento soporte y contabilidad automatizada.
