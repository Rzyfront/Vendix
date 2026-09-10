---
id: ADR-02
title: "Prevalencia de coincidencia de ciudad sobre discrepancias de departamento"
status: proposed
reversibility: trivial
updated: 2026-09-10
---
# ADR-02 — Prevalencia de coincidencia de ciudad sobre discrepancias de departamento

- **Context:** En Colombia y otros países de la región, la asignación político-administrativa entre ciudad y departamento genera discrepancias frecuentes entre fuentes de datos. Nominatim (OpenStreetMap) puede devolver `state: "Cundinamarca"` para `city: "Bogotá"`, mientras que API-Colombia expone el departamento como `"Bogotá"`. En la lógica previa de `resolveZone`, si una zona especificaba regiones y ciudades, el fallo en la región descartaba de inmediato la zona (`if (!geoNameInList(address.state_province, zone.regions)) return false`), incluso cuando la ciudad coincidía de forma exacta o canónica.
- **Decision:** Si una zona especifica ciudades (`zone.cities && zone.cities.length > 0`) y la ciudad de la dirección coincide (`geoNameInList(address.city, zone.cities)`), la coincidencia de ciudad valida la zona aunque exista discrepancia en el nombre del departamento/región. La validación de departamento solo actúa como filtro excluyente cuando la zona no especifica ciudades (zona de alcance departamental) o cuando la ciudad no coincide.
- **Consequences:** 
  - Erradica los falsos rechazos de cobertura en Bogotá D.C. y municipios limítrofes causados por divergencias de catálogos y geocodificadores.
  - Otorga primacía a la unidad territorial más granular y precisa (el municipio).
  - Mantiene el filtrado estricto por departamento cuando la zona se diseñó a nivel regional sin lista de ciudades.
- **Reversibility:** trivial — regla lógica en `shipping-calculator.service.ts` sin impacto en esquema ni mutación de datos.
- **Revisit if:** Coexistan dos municipios homónimos en distintos departamentos en la misma zona de envío y se requiera disambiguación forzada por departamento.
