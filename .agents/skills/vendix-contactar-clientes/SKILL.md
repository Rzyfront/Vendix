---
name: vendix-contactar-clientes
description: >
  Redacta mensajes comerciales a prospectos o clientes de Vendix con la biblioteca de plantillas.
  Trigger: When communicating with a Vendix prospect or client, adapting a commercial message template, or using the message template library in this skill.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Comunicarse con prospectos o clientes de Vendix"
    - "Adaptar una plantilla de mensaje comercial a un cliente"
    - "Usar la biblioteca de plantillas de mensajes de Vendix"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Contactar Clientes

## Purpose

Gobierna cómo el agente redacta mensajes a prospectos/clientes: siempre desde una plantilla de `templates/mensajes-comerciales/` (dentro de esta skill), adaptada con contexto mínimo del cliente. No gobierna estrategia comercial ni precios (ver web de Vendix y `vendix-business-analysis`).

## Core Rules

- NUNCA redactes desde cero si hay plantilla disponible: lista `templates/mensajes-comerciales/` y pide que elijan una.
- NUNCA envíes el mensaje sin el contexto básico del cliente (empresa + 1 dolor o proceso real).
- Máximo 3 párrafos cortos, tuteando, tono de la plantilla elegida (por defecto: cercano cachaco, no formal).
- Solo adapta las `[Variables]` de la plantilla; no agregues procesos, tecnicismos ni párrafos nuevos.
- Si ninguna plantilla encaja, dilo y propón crear una nueva en la biblioteca en vez de improvisar.
- Trata la fila CRM como hipótesis, no como verdad: los campos comerciales suelen ser optimistas o estar desactualizados. Nunca afirmes en el mensaje datos que no verificaste (problemas, decisiones, fechas).
- NUNCA firmes como el `Responsable` automáticamente: siempre pregunta a nombre de quién sale el mensaje.
- Aunque tengas toda la info, pregunta siempre por el enfoque opcional antes de redactar (ver Enfoques); sin enfoque, usa el neutro de la plantilla.
- Tras entregar el mensaje, ofrece el link `wa.me` de envío directo por WhatsApp.
- Nunca abras el navegador sin confirmación explícita del usuario.

## Workflow

1. Lista las plantillas de `templates/mensajes-comerciales/README.md` y pide: **1) que elijan plantilla**.
2. Pide: **2) contexto básico del cliente**: nombre de la empresa + 1 dolor o proceso (ej: "inventario de repuestos se descuadra"). Acepta también la fila CRM completa y extrae de ella solo lo necesario (ver Entrada CRM). Y pregunta siempre: **¿a nombre de quién sale el mensaje?** (nunca asumas que es el `Responsable`).
3. Pregunta por el **enfoque opcional** del mensaje (ver Enfoques): ofrece los ejemplos y la opción neutra. Si no indican enfoque, usa el neutro de la plantilla.
4. Lee la plantilla elegida, adapta solo sus variables con el enfoque elegido y devuelve el mensaje listo para copiar/pegar.
5. Ofrece el link `wa.me` de envío directo (ver Link wa.me).

## Entrada CRM

Formato habitual (una fila por prospecto, columnas separadas por tabulación):

`ID | Comercio | Cliente | Nicho | Ciudad | Direccion | Número | Responsable | Estado | Prioridad | Último Contacto | Próxima Acción | Fecha Próxima Acción | Probabilidad Cierre | Valor Proyectado | Estado Implementación | Nota`

| Campo | Uso en el mensaje |
| --- | --- |
| `Comercio` | Nombre de la empresa → variable `[Empresa]` |
| `Nicho`, `Ciudad`, `Nota` | Fuente del dolor/proceso (máx 3, con palabras del cliente). Úsalo como hipótesis con lenguaje suave ("la última vez veíamos...", "si no me equivoco...") |
| `Responsable` | Última persona que habló con el prospecto → NO es firma, es referencia de continuidad. Si el remitente es él: primera persona ("te saludo de nuevo"). Si es otro: mención en tercera persona ("Balmes se había comunicado contigo...", "retomo lo que veían con Balmes...") y firma el remitente real |
| `Último Contacto` | Calibra la cercanía: si es reciente, "como te comentaba"; si es viejo (>30 días), "hace un tiempo hablamos". Si el cliente probablemente ya no recuerda a Vendix (contacto >~3 meses o el usuario lo indica), presentación en fresco sin "de nuevo" |
| `Cliente` | Nombre del contacto, solo si viene con apellido o contexto claro; si es ambiguo no lo inventes |

Nunca menciones en el mensaje: `Estado`, `Prioridad`, `Probabilidad Cierre`, `Valor Proyectado`, `Estado Implementación`, `Próxima Acción` ni fechas internas. Son datos internos y suelen ser los más optimistas.

## Enfoques (opcional)

El enfoque tiñe el CTA y máximo 1 frase del mensaje; no agrega párrafos ni tecnicismos.

| Enfoque | Ajuste del mensaje |
| --- | --- |
| Retomar el uso de la app | El mensaje se dirige a brindarle apoyo para retomar el uso: qué retoma, ayuda disponible y un siguiente paso simple |
| Validar propuesta comercial | Seguimiento a la propuesta ya hecha; si por algún motivo o duda no encaja con lo que busca ahora, recordarle que hay opciones más discretas o más completas según su necesidad, para que siga creciendo sobre una base tecnológica sólida |
| Ofrecer servicio + propuesta | Ofrecer prepararle una propuesta comercial ajustada a sus necesidades: qué le ofrecemos, a qué costo, y proceso de condiciones e implementación |

## Link wa.me

Tras entregar el mensaje, ofrece el link de envío directo por WhatsApp:

`https://wa.me/<número>?text=<mensaje codificado>`

- `<número>`: el del CRM sin espacios, `+` ni guiones; si es un local de 10 dígitos (Colombia), antepone `57`.
- `<mensaje codificado>`: el texto final del mensaje URL-encoded.
- Nunca inventes el número: si la fila no trae `Número`, pídelo antes de generar el link.

### Apertura del chat (solo con confirmación)

Pregunta siempre antes ("¿abro el chat de [Empresa]?"). Solo ante un sí explícito, usa la primera estrategia disponible en este orden:

| Orden | Estrategia | Cómo |
| --- | --- | --- |
| 1 | Playwright MCP (si está disponible) | `browser_navigate` al link y verifica número + texto precargado en la página |
| 2 | agent-browser (fallback) | Abrir el link según `how-to-test` |
| 3 | Apertura del SO (sin MCP, con shell) | macOS: `open "<url>"` · Linux: `xdg-open "<url>"` · Windows: `start "" "<url>"` o `Start-Process "<url>"` |
| 4 | Solo validación (sin navegador) | `curl -sIL "<url>"`: debe devolver 200 y redirigir a `api.whatsapp.com` |

Notas: la apertura del SO requiere sesión de escritorio con navegador; en SSH, Docker o headless falla y se reporta sin reintentar a ciegas. Abrir el chat NO envía el mensaje: el envío final siempre lo hace el humano.

## Ejemplos de sesión (tanda Riohacha, sep-2026)

- **Continuidad con tercero:** "Soy Rafael Martinez... Balmes Brito se había comunicado contigo hace un tiempo y retomo por aquí" — el Responsable se nombra, nunca se suplanta.
- **Primer contacto:** "Te escribo para saludarte y contarte rapidito lo que hacemos." Sin "de nuevo" cuando el cliente probablemente no recuerda a Vendix.
- **Rescate anónimo:** sin nombrar el comercio ("negocios como tu cava o bar") + anti-complejidad ("solo activas lo que necesites, nada complejo ni todo de una vez"). Ante nota de rechazo ("no quieren el servicio"): no redactes en automático, propón saltar o un check-in suave sin vender.
- **Prueba social nombrada:** "Tuvimos el gusto de conocernos en Multivariedades Ever, donde ya estamos funcionando todos los días" — nombra el cliente en operación solo con dato verificado por el usuario.
- **Vs. competencia sin atacar:** "Vendix va más allá de cualquier app suelta" — posiciona sin nombrar ni agredir.
- **Negocio caído con empatía:** "sé que a veces la operación se pone difícil... para ayudarte a arrancar, retomar o hacer crecer tu idea" — nunca afirmes el cierre.

## Decision Rules

| Situation | Use |
| --- | --- |
| Usuario pide escribir a un prospecto sin elegir plantilla | Lista la biblioteca y pide que elija una antes de redactar |
| Falta empresa o dolor del cliente | Pide solo esos 2 datos, o acepta la fila CRM completa |
| Piden un mensaje para un caso sin plantilla | Redacta una vez, luego propone guardarla en la biblioteca |
| La `Nota` describe un dolor pero el `Último Contacto` es viejo | Preséntalo como hipótesis ("la última vez veíamos... ¿sigue así?") en vez de afirmarlo |
| `Probabilidad`/`Valor`/`Estado` suenan prometedores | Ignóralos en el mensaje; no presiones ni des por hecho el cierre |
| El remitente es distinto al `Responsable` | Mención en tercera persona ("Balmes se había comunicado contigo...") y firma del remitente real, nunca "Soy Balmes" |
| Ya hay toda la info para redactar | Pregunta igual por el enfoque opcional antes de redactar |
| Quieren enviarlo ya por WhatsApp | Genera el link `wa.me` con el `Número` del CRM |
| Usuario confirma abrir el chat | Usa la primera estrategia disponible de la cascada; sin navegador, valida con `curl` y entrega el link |
| WhatsApp dice que el número no existe | No pruebes variantes ni reintentes: el formato ya se validó contra el CRM, el dato está mal. Repórtalo, pide verificación del número y sigue con el siguiente prospecto |
| El cliente probablemente no recuerda a Vendix | Presentación en fresco, sin "de nuevo" ni mención de contactos previos |
| La nota indica rechazo ("no quieren el servicio") | No redactes en automático: propón saltar o un check-in suave sin vender |

## Related Skills

- `vendix-business-analysis` - Para análisis de negocio previo a cambios de pricing o facturación
- `skill-sync` - Requerida después de crear o modificar esta skill
