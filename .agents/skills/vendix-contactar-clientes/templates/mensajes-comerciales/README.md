# Biblioteca de plantillas de mensajes comerciales

Set de plantillas para comunicarse con prospectos y clientes de Vendix por WhatsApp / email corto.

## Plantillas disponibles

| Plantilla | Archivo | Uso |
| --- | --- | --- |
| Saludo cachaco de recontacto | `saludo-cachaco-recontacto.md` | Retomar contacto previo, tono cercano bogotano, tuteando |

## Cómo agregar una nueva plantilla

1. Crea un `.md` nuevo en esta carpeta con nombre `tema-tipo.md` (ej: `seguimiento-demo.md`).
2. Estructura mínima: `Tono`, `Plantilla` (con `[Variables]`), `Variables`, `Ejemplo adaptado`, `No hacer`.
3. No dupliques reglas de la skill `vendix-contactar-clientes`; solo el texto y sus variables.
