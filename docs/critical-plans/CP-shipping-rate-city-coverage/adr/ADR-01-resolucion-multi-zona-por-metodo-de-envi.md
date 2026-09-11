---
id: ADR-01
title: "Resolución multi-zona por método de envío con jerarquía de especificidad"
status: proposed
reversibility: costly
updated: 2026-09-10
---
# ADR-01 — Resolución multi-zona por método de envío con jerarquía de especificidad

- **Context:** En el modelo actual, `ShippingCalculatorService.resolveZone` selecciona una sola zona ganadora (`candidates[0]`) para toda la cotización comparando especificidad geográfica. Si una tienda tiene un método "Envío Nacional" en una zona general y el comerciante crea una tarifa para su ciudad (ej. "Entrega Local" o "Retiro en Tienda"), la zona de la ciudad gana por especificidad y excluye a la zona nacional. Si la zona de la ciudad no contiene tarifas aplicables a domicilio, el comprador recibe "No hay cobertura de envío para esta dirección" a pesar de existir cobertura nacional.
- **Decision:** Cambiar la resolución de zona única a resolución de candidatos aplicables. El calculador identificará todas las zonas que cubran la dirección (`matchingZones`), consultará las tarifas activas de dichas zonas en una sola consulta (`shipping_zone_id: { in: matchingZoneIds }`), y para cada método de envío activo seleccionará la tarifa de la zona con mayor especificidad. Los métodos que solo existen en zonas más amplias seguirán cotizándose normalmente.
- **Consequences:** 
  - Compradores en ciudades con tarifas locales verán tanto su método local como los métodos nacionales disponibles.
  - Se elimina el bloqueo falso de cobertura cuando una zona hiper-específica carece de métodos a domicilio.
  - La respuesta de la API mantiene exactamente la interfaz `ShippingOption[]`, garantizando cero impacto en frontend.
- **Reversibility:** costly — cambiar la semántica de resolución requiere mantener la compatibilidad con tiendas que asumen partición disjunta de zonas, pero beneficia al 100% de los comercios con entrega local + nacional.
- **Revisit if:** Se implementen perfiles de envío disjuntos a nivel de producto (estilo Shopify shipping profiles), donde cada producto pertenezca a un perfil de tarifa independiente.
