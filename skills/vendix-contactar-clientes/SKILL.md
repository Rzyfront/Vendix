---
name: vendix-contactar-clientes
description: >
  Redacta mensajes comerciales a prospectos o clientes de Vendix con la biblioteca de plantillas.
  Trigger: When communicating with a Vendix prospect or client, adapting a commercial message template, or using the message template library in this skill.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
disable-model-invocation: true
---

# Vendix Contactar Clientes

Mensajes a prospectos/clientes siempre desde una plantilla de `templates/mensajes-comerciales/`
(índice en su `README.md`), adaptada con contexto mínimo. No cubre estrategia comercial ni precios
(`vendix-business-analysis`).

## Reglas

- Nunca redactes desde cero si hay plantilla; si ninguna encaja, dilo, redacta una vez y propón guardarla.
- Sin contexto básico (empresa + 1 dolor o proceso real) no hay mensaje.
- Máx 3 párrafos cortos, tuteando, tono de la plantilla (por defecto cercano cachaco). Solo adapta las
  `[Variables]`; nada de procesos, tecnicismos ni párrafos nuevos.
- La fila CRM es hipótesis, no verdad: nunca afirmes problemas, decisiones ni fechas no verificadas.
- Nunca firmes como el `Responsable`: pregunta siempre a nombre de quién sale.
- Pregunta siempre por el enfoque opcional antes de redactar; sin enfoque, el neutro de la plantilla.
- Nada robótico: varía apertura, conector y CTA en cada tanda; si dos mensajes suenan iguales, reescribe uno.
- A quien ya visitamos o tuvo implementación, nunca plantilla fría.
- Fraseos estándar: "con módulos y facturación electrónica sin límites" (la competencia limita folios);
  "planes bien económicos desde $49.900, al mejor precio posible" + "escalas según lo que necesites,
  solo activas lo que necesites".
- Nunca menciones cifras de una propuesta ni degrades el software actual del cliente.

## Flujo

1. Lista la biblioteca y pide que elijan plantilla.
2. Pide empresa + 1 dolor/proceso (o la fila CRM completa) y **a nombre de quién sale**.
3. Pregunta el enfoque: retomar el uso de la app / validar propuesta comercial / ofrecer servicio + propuesta / neutro.
4. Adapta solo las variables y entrega el mensaje listo para copiar.
5. Ofrece el link `https://wa.me/<número>?text=<mensaje URL-encoded>`: número del CRM sin espacios,
   `+` ni guiones; 10 dígitos colombianos → antepone `57`. Sin `Número` → pídelo, nunca lo inventes.
6. Abrir el chat solo con confirmación explícita ("¿abro el chat de [Empresa]?"). Abrirlo no envía:
   el envío siempre lo hace el humano.

Uso de campos CRM, tono por nicho y contexto, enfoques, reglas de casos y cascada de apertura del chat:
`references/crm-y-tono.md` (leer bajo demanda).
