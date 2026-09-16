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
- Diferencial estándar (úsalo cuando el enfoque lo pida): módulos y facturación electrónica DIAN **sin límites** ni recargos por folio — la competencia los limita, Vendix no. Fraseo: "con módulos y facturación electrónica sin límites".
- NADA robótico: la plantilla da la estructura, nunca el texto literal en serie. Varía apertura, conector y CTA en cada tanda, adapta cercanía y procesos al contexto real del cliente (ver Dinamismo según contexto). Si dos mensajes seguidos suenan idénticos, reescribe uno.
- Precio y escalabilidad (fraseo estándar, adaptable): "planes bien económicos desde $49.900, al mejor precio posible / a precio óptimo" + "escalas según lo que necesites, sin tener todo de golpe, solo activas lo que necesites".

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
| `Cliente` | Saluda siempre con su nombre de pila cuando el campo lo trae (con o sin apellido). Solo omítelo si viene vacío. Nunca inventes nombres ni apellidos |

Nunca menciones en el mensaje: `Estado`, `Prioridad`, `Probabilidad Cierre`, `Valor Proyectado`, `Estado Implementación`, `Próxima Acción` ni fechas internas. Son datos internos y suelen ser los más optimistas.

## Dinamismo según contexto (anti-robot)

No uses la misma fórmula para todos. Calibra con `Nicho` + `Nota` + `Último Contacto` + cercanía real:

| Contexto | Tono y contenido |
| --- | --- |
| Ex-cliente con implementación en vivo en su local | Habla en plural de equipo ("estuvimos contigo", "conocemos tu local", "te acompañamos"), nunca como desconocido. Reconoce sin culpar ("sé que en su momento no te funcionó para tu local"), cuenta novedades (nuevos planes, funcionalidades que en su momento necesitó) y cierra con escalabilidad. Permite 1 frase extra de reconocimiento, sigue compacto |
| Ferretería / materiales | Procesos: ventas por unidades de medida (metros, litros, unidades, cajas, bultos), inventario, facturación DIAN. Menciona www.vendix.online como vitrina de novedades |
| Retail, variedades, repuestos, motos | Procesos: ventas, inventario, WhatsApp + facturación DIAN. Directo a operación diaria |
| Artesanías, wayuu, moda, accesorios | Procesos: ventas en línea / comercio online, control de inventario, facturación. Enfoque en crecimiento empresarial y escalamiento a precio óptimo |
| Cliente conocido en persona | Cercanía cálida con nombre de pila ("Hola Ángel, ¿cómo vas?"), referencia concreta y breve a lo vivido, sin intimidades |
| Interesado frío / Nuevo Lead sin historia | Presentación en fresco, sin "de nuevo". Dolor como hipótesis suave ("si manejas..."), CTA simple de 15 min |
| Nota con rechazo o molestia | No vendas en automático: check-in suave o propone saltar. Empatía primero ("sé que a veces la operación se pone difícil") |

Variación obligatoria en tanda: alterna aperturas ("Hola [Nombre], ¿cómo vas?" / "Hola [Nombre], ¿cómo va todo por [Empresa]?" / "[Nombre], pasaba a saludarte"), conectores ("Te escribía rapidito" / "Te escribía con novedades" / "Retomo por aquí") y CTAs ("¿Agendamos miradita de 15 min?" / "¿Te sirve una miradita de 15 min?" / "¿Te preparo propuesta a tu medida?"). Mismo esqueleto, nunca mismo texto.

## Enfoques (opcional)

El enfoque tiñe el CTA y máximo 1 frase del mensaje; no agrega párrafos ni tecnicismos.

| Enfoque | Ajuste del mensaje |
| --- | --- |
| Retomar el uso de la app | El mensaje se dirige a brindarle apoyo para retomar el uso: qué retoma, ayuda disponible y un siguiente paso simple |
| Validar propuesta comercial | Seguimiento que la presenta como muy buena y necesaria para despegar: subir el nivel de ventas y el control de la empresa. Solo ofrece ajustarla u otras opciones (discretas/completas) si el usuario lo pide explícito |
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
- **Ex-cliente Ferretería Salomé (sep-2026):** corrección "sonaba a desconocido" → reescritura en plural ("estuvimos en tu local", "te acompañamos") + novedades (nuevos planes, funcionalidades que pidió) + escalabilidad ("sin tener todo de golpe") + unidades de medida (metros, litros, unidades, cajas, bultos). Regla: a quien ya visitamos, nunca plantilla fría.
- **Wayuu / Elnushi (sep-2026):** sin número → no hay link, se pide dato. Mensaje igual se entrega con foco en ventas en línea, inventario, facturación, crecimiento y escalamiento a precio óptimo.
- **Multirepuesto Rivera (sep-2026):** saludo con nombre de pila + continuidad con tercero (Balmes) + todo ferretero en una plataforma + Impulsa $49.900 + escalabilidad + propuesta a medida. Verificado en navegador contra +57 314 7524479.

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
| La estrategia es superar su software actual | Es contexto interno: el mensaje nunca degrada lo que tienen ("por encima de lo que ya tienes" prohibido). Persuade mostrando bondades, nunca comparando hacia abajo |
| Hay valores de una propuesta (precios, millones) | NUNCA los menciones: es agresivo. Que el cliente los recuerde por sí mismo; el mensaje presenta la propuesta como excelente, jamás cifras |
| Validar propuesta sin instrucción explícita | Preséntala como muy buena y necesaria para despegar (ventas + control); NUNCA ofrezcas ajustarla por defecto |
| La `Nota` trae detalles íntimos (prórrogas, dudas, lo que habló con otro agente) | Úsala solo como contexto mudo para el enfoque. NUNCA la recites ("sé que pediste prórroga" prohibido): persuade ofreciendo el servicio |
| Dos mensajes seguidos suenan iguales | Reescribe uno variando apertura, conector y CTA; nunca entregues tanda con texto calcado |
| Ex-cliente que ya tuvo implementación en vivo | Plural de equipo + reconocimiento breve sin culpar + novedades y escalabilidad; prohibida la plantilla fría de desconocido |
| Nicho ferretero | Incluye ventas por unidades de medida (metros, litros, unidades, cajas, bultos) entre los máx 3 procesos |
| Nicho artesanías / wayuu / moda | Prioriza ventas en línea / comercio online + inventario + facturación, con crecimiento y escalamiento a precio óptimo |
| Link sale con texto pegado de otro cliente | Regenera el `wa.me` limpio desde el mensaje final con URL-encoding nuevo; nunca edites la URL a mano |
| Snapshot Playwright sale en blanco | Toléralo si la URL verificada trae `phone=` correcto + `text=` precargado; el ticket ya valida formato, no existencia del número |

## Related Skills

- `vendix-business-analysis` - Para análisis de negocio previo a cambios de pricing o facturación
- `skill-sync` - Requerida después de crear o modificar esta skill
