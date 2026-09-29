---
id: ADR-11
title: "La propina porcentual se calcula sobre el subtotal bruto de productos"
status: accepted
reversibility: costly
updated: 2026-09-23
---
# ADR-11 — La propina porcentual se calcula sobre el subtotal bruto de productos

- **Context:** E.6 halló tres carriles con bases divergentes: la mesa y el POS retail usan subtotal de productos más impuesto; `flow/pay` usa subtotal sin impuesto. Sobre $100.000 de base y $19.000 de IVA, una propina de 10 % quedaba en $11.900 o $10.000 según la pantalla.
- **Decision:** A solicitud del dueño, el orquestador recomendó y eligió el **subtotal bruto de productos** (`subtotal_amount + tax_amount`, sin propina ni envío) como única base porcentual. En el ejemplo, la propina es $11.900. Los tres carriles usarán `resolveTip` y el mismo redondeo. La propina sigue fuera de la base gravable y del impuesto; se suma una sola vez a `grand_total` como pasivo de custodia. El dueño delegó expresamente esta elección el 2026-09-23.
- **Consequences:** La cifra visible del porcentaje coincide con la cuenta de productos que ve el comensal y con la mayoría de carriles actuales. Las nuevas ventas de `flow/pay` pueden registrar propina mayor que antes si incluyen impuestos. No se reliquida ni se reescribe ninguna venta histórica; pruebas de tabla y de tres carriles fijan la nueva regla.
- **Reversibility:** costly — revertir código no devuelve el dinero ya entregado ni altera pagos históricos.
- **Revisit if:** el dueño quiere una base sin impuesto o incluir envío en el porcentaje; ambas opciones cambian dinero y exigen nueva decisión explícita.
