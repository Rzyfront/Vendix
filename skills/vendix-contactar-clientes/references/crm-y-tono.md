# CRM, tono, enfoques y casos

## Entrada CRM

Fila habitual (tabulada): `ID | Comercio | Cliente | Nicho | Ciudad | Direccion | Número | Responsable | Estado | Prioridad | Último Contacto | Próxima Acción | Fecha Próxima Acción | Probabilidad Cierre | Valor Proyectado | Estado Implementación | Nota`

| Campo | Uso |
| --- | --- |
| `Comercio` | `[Empresa]` |
| `Nicho`, `Ciudad`, `Nota` | Dolor/proceso (máx 3, con palabras del cliente), como hipótesis suave ("la última vez veíamos...", "si no me equivoco...") |
| `Responsable` | Continuidad, NO firma. Si es el remitente: primera persona ("te saludo de nuevo"). Si no: tercera persona ("Balmes se había comunicado contigo...") y firma el remitente real |
| `Último Contacto` | Reciente: "como te comentaba"; >30 días: "hace un tiempo hablamos"; >~3 meses o el usuario lo indica: presentación en fresco, sin "de nuevo" |
| `Cliente` | Saluda con nombre de pila si viene; nunca inventes nombres |

Nunca menciones `Estado`, `Prioridad`, `Probabilidad Cierre`, `Valor Proyectado`, `Estado Implementación`, `Próxima Acción` ni fechas internas.

## Dinamismo según contexto

| Contexto | Tono y contenido |
| --- | --- |
| Ex-cliente con implementación en vivo | Plural de equipo ("estuvimos contigo", "te acompañamos"); reconoce sin culpar ("sé que en su momento no te funcionó"); novedades (planes, funcionalidades que pidió) y escalabilidad. 1 frase extra permitida. Nunca plantilla fría |
| Ferretería / materiales | Ventas por unidades de medida (metros, litros, unidades, cajas, bultos), inventario, facturación DIAN; www.vendix.online como vitrina |
| Retail, variedades, repuestos, motos | Ventas, inventario, WhatsApp + facturación DIAN |
| Artesanías, wayuu, moda, accesorios | Ventas en línea, inventario, facturación; crecimiento y escalamiento a precio óptimo |
| Conocido en persona | Cercanía cálida con nombre de pila, referencia breve a lo vivido, sin intimidades |
| Lead frío sin historia | Presentación en fresco, dolor como hipótesis ("si manejas..."), CTA de 15 min |
| Nota con rechazo o molestia | No vendas: check-in suave o propón saltar; empatía primero |

Variación en tanda: aperturas ("Hola [Nombre], ¿cómo vas?" / "¿cómo va todo por [Empresa]?" / "[Nombre], pasaba a saludarte"), conectores ("Te escribía rapidito" / "con novedades" / "Retomo por aquí"), CTAs ("¿Agendamos miradita de 15 min?" / "¿Te sirve una miradita de 15 min?" / "¿Te preparo propuesta a tu medida?").

## Enfoques (tiñen el CTA y máx 1 frase)

| Enfoque | Ajuste |
| --- | --- |
| Retomar el uso de la app | Apoyo para retomar: qué retoma, ayuda disponible, siguiente paso simple |
| Validar propuesta comercial | Presentarla como muy buena y necesaria para despegar (ventas + control). Ajustarla u ofrecer opciones solo si el usuario lo pide |
| Ofrecer servicio + propuesta | Ofrecer propuesta a medida: qué, a qué costo, condiciones e implementación |

## Reglas de casos

| Situación | Acción |
| --- | --- |
| Caso sin plantilla | Redacta una vez y propón guardarla en la biblioteca |
| Estrategia: superar su software actual | Contexto interno; nunca degradar lo que tienen ("por encima de lo que ya tienes" prohibido) |
| Hay cifras de una propuesta | Nunca mencionarlas |
| `Nota` con detalles íntimos (prórrogas, dudas, otro agente) | Contexto mudo; nunca recitarlos |
| Prueba social con cliente nombrado | Solo con dato verificado por el usuario |
| Competencia | Posicionar sin nombrar ni atacar ("Vendix va más allá de cualquier app suelta") |
| Negocio caído | Empatía, nunca afirmar el cierre |
| Link con texto de otro cliente | Regenerar el `wa.me` desde el mensaje final; nunca editar la URL a mano |
| WhatsApp dice que el número no existe | No probar variantes; reportar, pedir verificación y seguir |
| Snapshot de Playwright en blanco | Aceptable si la URL trae `phone=` correcto y `text=` precargado |

## Apertura del chat (solo con "sí" explícito; primera disponible)

1. Playwright MCP: `browser_navigate` al link y verificar número + texto precargado.
2. agent-browser (fallback, según `how-to-test`).
3. SO: macOS `open "<url>"` · Linux `xdg-open "<url>"` · Windows `start "" "<url>"`.
4. Sin navegador: `curl -sIL "<url>"` → 200 y redirección a `api.whatsapp.com`.

En SSH/Docker/headless la apertura falla: reportar sin reintentar a ciegas.
