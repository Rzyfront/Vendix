# Revisión de QA — POS, órdenes y tienda (27-09-2026)

## Alcance y método

Se corrigieron los 21 hallazgos comunicados para `develop`. La verificación funcional de este informe se hizo **en la interfaz** de la tienda local Roku con Playwright/Chrome, usando `https://vendix.com` para administración y `https://roku-shop.vendix.com` para la tienda. No se usaron solicitudes directas a la API para demostrar comportamiento funcional. Los casos que exigían configuración de impuestos, ofertas o fotografías de variantes se prepararon desde formularios UI y se restauraron después. Las órdenes QA creadas se identifican abajo; algunas ventas y tickets quedan como evidencia en la base de desarrollo.

| # | Cambio implementado | Verificación visible en UI |
|---|---|---|
| 1–3 | El cobro múltiple valida **antes** de salir del paso de métodos. Solo efectivo puede generar cambio; una transferencia excesiva explica el sobrante y bloquea Siguiente/Enter. Se permiten dos transferencias distintas válidas y se evita duplicar el tramo de efectivo. | Efectivo $20.000 + transferencia $20.000 contra $38.000 mostró sobrante de $2.000 y no avanzó; dos transferencias ($18.000 + $20.000) finalizaron POS-2026-0380. |
| 4 | El importe manual de envío hereda la configuración tributaria de la tarifa seleccionada automáticamente. | Tarifa aditiva $10.000 → $11.900; edición a $12.000 → $14.280 con IVA $2.280; finalizó POS-2026-0384. Tarifa con IVA incluido editada a $18.000 conservó total $18.000 y desglosó base $15.126,06/IVA $2.873,94 en POS-2026-0393. |
| 5 | Wallet puede ser un tramo de pago mixto sin tratarse como cambio en efectivo. | Saldo insuficiente bloqueó $420.000; efectivo $1.000 + Wallet $37.000 cerraron POS-2026-0382 y el detalle mostró ambos pagos exitosos. |
| 6 | Un artículo directo no permite despachar indirectamente los platos pendientes de cocina; la misma restricción gobierna detalle y mutación. | POS-2026-0386 mezcló gaseosa y plato pendiente: Despachar Orden quedó inhabilitado, el plato no tuvo Entregar, y la gaseosa sí pudo entregarse individualmente sin entregar el plato. |
| 7 | El pago inicial de crédito usa el control monetario y símbolo de moneda de la tienda. | Plan a cuotas en POS-2026-0387 mostró `$` en Pago inicial. |
| 8 | Se retiró Estado de la tabla de clientes. | La tabla de Clientes no presentó encabezado Estado; caso automatizado `--group lists` aprobado. |
| 9 y 21 | La oferta muestra precio final y tratamiento IVA, y el precio tachado se calcula **con el mismo IVA** que la oferta. | Producto gravado Frutas Orgánicas Mix 1kg: base $22.000 → regular $26.180; oferta base $20.000 → final $23.800. Vista previa indicó impuestos agregados; tarjeta `/sale` mostró $23.800 frente a $26.180, no $22.000. Oferta temporal restaurada. |
| 10 | Filtro de órdenes por forma de pago liquidada. | En Órdenes → Filtros → Forma de pago → Efectivo, la selección persistió y actualizó el listado; caso `--group lists` aprobado. |
| 11 | El abono de crédito excesivo ofrece explicación concreta y bloquea el guardado. | POS-2026-0387: se intentó abonar $40.000 contra saldo $38.000; la UI explicó exceso de $2.000 y deshabilitó Registrar Abono. |
| 12 | División de cuentas de mesa y detalle con selección/gestión de partes, estados de pago consistentes y cierre de mesa pagada. | Mesa QA G2 sesión 158: cuatro comensales, vista previa $7.500 por parte, cuatro cuentas generadas y pagadas; tras recargar saldo cero, mesa Pagada y cierre posible. En detalle de orden #1335 se crearon y mostraron cuatro partes independientes de $250; luego se anularon sin cobro. |
| 13 | El listado muestra neto vigente y marca reembolso parcial/total. | POS-2026-0376 mostró Neto actual $8.000 y Reembolso parcial; POS-2026-0388 reembolsada totalmente mostró neto $0, estado Reembolsada y stock repuesto. |
| 14 | POS y tienda calculan la variante con IVA; cambiar variante actualiza precio e imagen, con fallback a imagen base. | Samsung con IVA 19% temporal: 75″ $5.472.810, 65″ $3.925.810, 55″ $2.616.810 tanto en selector como tienda; carrito POS 55″ base $2.199.000 + IVA $417.810. Imágenes temporales roja/azul alternaron para 75″/65″; 55″ usó foto base. IVA e imágenes QA se restauraron. |
| 15 | Enter acepta las opciones por defecto del Wizard de cobro. | POS-2026-0381 terminó por Enter: Para llevar → anónimo → Contado → Efectivo → monto exacto; ticket por $38.000. |
| 16 | Editar borrador conserva su ID, fotos de artículos previos y guardado directo, sin cancelar y recrear. Además, el POS descarta el carrito vinculado si el borrador fue cancelado desde otra vista. | Borrador POS-2026-0391 (#1334): se agregó ítem, foto Samsung persistió y se guardó la misma orden vía editor, sin repetir Wizard; se canceló QA. Borrador #1335 cancelado desde detalle: al volver a POS quedó carrito vacío, sin orden vinculada. |
| 17 | POS respeta Permitir sobreventa y mejora el bloqueo cuando está apagada. | Con ON, QA NoOversell A stock 0 se agregó con alerta SOBREVENTA y se vendió en POS-2026-0388; stock -1. Con OFF mostró AGOTADO y bloqueó con mensaje accionable. ON restaurado; reembolso devolvió stock 0. |
| 18 | Cancelar ticket pendiente reintegra insumos automáticamente; desde En preparación pregunta si reutilizar o desechar. | Ticket #139 pendiente: no preguntó, movimientos +300 pollo/+10 especias compensaron consumo. Ticket #140 En preparación → Desechar: sin movimientos positivos. Ticket #141 → Reutilizar: +300/+10 en inventario. |
| 19 | El alias/referencia de cliente no impide autoseleccionar la tarifa de envío que cubre la dirección. | Con alias y dirección Riohacha la tarifa E2E-SHIPPING se seleccionó sola, sin crear cliente ni editarla obligatoriamente; POS-2026-0384 terminó. Bogotá no obtuvo tarifa porque la cobertura configurada no llega allí, que es correcto. |
| 20 | Contra entrega mantiene pago pendiente hasta cobrar, registra método real y elimina acciones duplicadas/incoherentes del detalle. | POS-2026-0385: confirmado efectivo $43.000; POS-2026-0386: transferencia $71.000 con banco/referencia. Detalle conservó marcador Contra Entrega cancelado/reemplazado y pago real exitoso. POS-2026-0393: un solo Despachar Orden, remisión REM2609270002, Entregada con pago pendiente, luego Confirmar Pago efectivo $19.000 y Finalizar Orden → FINALIZADA. |

## Automatización reutilizable

`tests/e2e/review-2026-09-27.spec.cjs` contiene comprobaciones UI de regresión para R8, R9, R10, R13, R14 y R21. El grupo público `--group storefront` pasó cinco recorridos R14 sin login: ficha desktop, vista rápida desde carrusel, ficha móvil, foto base heredada y variante con su precio en carrito invitado. `tests/e2e/review-payments-2026-09-27.spec.cjs` pasó cinco escenarios UI para R1–R3 y R15, incluyendo cobro doble intencional sin duplicar la orden. Se observaron las órdenes QA POS-2026-0401, 0402 y 0403 en detalle y tras recarga. Los demás casos de la tabla se ejecutaron con navegador Playwright interactivo y se documentaron con IDs de órdenes/tickets. **No interpretar estos diez IDs con alguna automatización como cobertura automática de los 21**: `--all` debe fallar si no hay escenario automatizado para cada requisito.

## Auditoría frente a la meta de verificación total

La tabla anterior acredita recorridos concretos, **no** una garantía del 100 % de combinaciones. Según `how-to-test`, cada flujo necesita camino feliz, error de uso e integridad/abuso. Al ampliar la suite, este es el estado que aún falta cerrar; «parcial» significa que existe evidencia UI pero no para todas las rutas del plan.

| Hallazgos | Feliz | Error de uso | Integridad / abuso | Brecha principal |
|---|---|---|---|---|
| R1–R3, R15 | Parcial | Parcial | Parcial | Ya pasaron cambio en efectivo, referencias faltantes, tramo cero, Enter por defecto y doble envío; faltan foco en buscadores/campos y otras combinaciones de pago. |
| R4, R19 | Parcial | Pendiente | Pendiente | Cambio entre varias tarifas y equivalencia alias/cliente formal con la misma dirección; recarga de detalle fiscal. |
| R5 | Parcial | Parcial | Pendiente | Débito Wallet antes/después y reintento concurrente sin cargo duplicado, observados desde UI. |
| R6 | Parcial | Parcial | Pendiente | Completar ticket KDS y entonces despachar; reintentar despacho/entrega, incluido `skip_kds` con ticket existente. |
| R7, R11 | Parcial | Parcial | Pendiente | Abono válido tras el rechazo, saldo y movimientos estables tras recarga; moneda configurada distinta. |
| R8 | Parcial | Pendiente | Pendiente | Tabla y tarjeta responsive sin regresión de datos/filtros. |
| R9, R21 | Parcial | Pendiente | Pendiente | IVA incluido además de aditivo y comparación en todas las superficies de venta. |
| R10 | Parcial | Pendiente | Pendiente | Método real en venta multimétodo, filtros combinados y ausencia de falso positivo. |
| R12 | Parcial | Pendiente | Pendiente | Entrada POS, titulares, abonos parciales, envío gravado, recarga y doble cobro en mesa/detalle. |
| R13 | Parcial | Pendiente | Pendiente | Reembolso pendiente/fallido no debe afectar el neto y vista responsive. |
| R14 | Parcial | Pendiente | Parcial | Ya pasaron vista rápida, móvil, foto fallback y carrito; faltan imagen propia y carrito/checkout con variante gravada, repetibles sin dejar fixture cambiado. |
| R16 | Parcial | Parcial | Pendiente | Doble Guardar, dos pestañas y cancelar mientras se edita, conservando ID/stock/imágenes. |
| R17 | Parcial | Parcial | Pendiente | Variante agotada, incremento de cantidad y viewport móvil con ON/OFF. |
| R18 | Parcial | Pendiente | Pendiente | Cancelación por ítem/orden, cierre del modal y segundo intento sin reintegro duplicado. |
| R20 | Parcial | Pendiente | Pendiente | Datáfono habilitado, segunda confirmación/cross-tab y un único cobro tras recarga. |

Un fallo intermitente de los tests de catálogo coincidió con respuestas `504 Gateway Time-out` del entorno local; no se convierte en PASS por reintento ni se atribuye automáticamente a la lógica de precios. La suite debe volver a ejecutarse estable antes de cerrar la meta.

## Límites y seguimiento

- Datáfono no está activo en la tienda QA: se verificaron en UI efectivo y transferencia para contra entrega, no el cobro con datáfono.
- No se probaron exhaustivamente todas las combinaciones de tarifas, productos, métodos, estados KDS, parcialidades y navegación por Enter; el usuario hará una pasada manual adicional.
- El flujo de login local ocasionalmente necesita reabrir `/admin/pos` tras autenticarse y el servidor de desarrollo puede mostrar una pantalla transitoria de reconexión durante rebuilds. El harness reintenta mediante la propia UI.
- Se observó ocasionalmente un `NG0100 ExpressionChangedAfterItHasBeenCheckedError` de `PosOrderConfirmationComponent` en consola después de completar una venta; la venta y el ticket sí terminaron. Queda como hallazgo separado para aislar si no se corrige en este lote.
- La caja QA E2E-A y el turno de cocina pueden permanecer abiertos en desarrollo tras la comprobación; no afectan producción.
