import { PrismaClient, ai_model_type_enum } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedAIEngineAppsResult {
  appsCreated: number;
  appsSkipped: number;
}

/**
 * AI Engine Applications Seed
 *
 * Seeds default AI application definitions only when missing — never
 * overwrites user-edited prompts, temperature, max_tokens, or config_id.
 *
 * No dependencies on other seeds — ai_engine_applications is a global table.
 */
export async function seedAIEngineApps(
  prisma?: PrismaClient,
): Promise<SeedAIEngineAppsResult> {
  const client = prisma || getPrismaClient();
  console.log('  Seeding AI Engine applications...');

  const apps = [
    {
      key: 'invoice_ocr',
      name: 'Escaner de Facturas de Compra',
      description:
        'Extrae datos estructurados de imagenes de facturas de compra usando vision AI',
      output_format: 'json',
      // Vision OCR returns text/JSON from an image input; the underlying model
      // is a text-output (vision-capable) model.
      model_type: 'text' as ai_model_type_enum,
      temperature: 0.1,
      max_tokens: 4000,
      is_active: true,
      system_prompt: `You are a purchase invoice data extraction system. You analyze invoice images and return structured JSON.

You MUST return ONLY valid JSON matching this EXACT schema — no markdown, no explanations, no extra fields:

{
  "supplier": {
    "name": "string — full business name",
    "tax_id": "string or null — NIT with verification digit",
    "address": "string or null",
    "phone": "string or null"
  },
  "invoice_number": "string",
  "invoice_date": "YYYY-MM-DD",
  "payment_terms": "string or null",
  "line_items": [
    {
      "description": "string — product name as printed",
      "quantity": number,
      "unit_price": number,
      "total": number,
      "sku_if_visible": "string or null — product code/reference if visible"
    }
  ],
  "subtotal": number,
  "tax_amount": number,
  "total": number,
  "confidence": number (0-100)
}

RULES:
1. Use EXACTLY these field names. Do NOT translate, rename, or add fields not in the schema.
2. Convert Colombian number formats (1.234.567,89) to standard (1234567.89). Never return formatted numbers.
3. NIT may appear as "NIT", "N.I.T.", "CC". Include verification digit with hyphen (e.g., "900123456-7").
4. tax_amount = ONLY IVA. Do not include retenciones (ReteFuente, ReteICA, ReteIVA).
5. Use null when a field is not present. Never invent data.
6. Extract ALL visible line items. Use "sku_if_visible" for codes in columns like "Código", "Ref", "SKU".
7. confidence: 90-100 clear image, 70-89 partially unclear, below 70 poor quality.`,
      // prompt_template is null — for vision apps, text instructions must be
      // in the same message as the image (handled by scanInvoice()).
      prompt_template: null,
    },
    {
      key: 'rut_scanner',
      name: 'Escaner de RUT (Identidad Fiscal)',
      description:
        'Extrae datos fiscales colombianos normalizados de un documento RUT (imagen o PDF) usando vision AI',
      output_format: 'json',
      // Vision OCR returns JSON from an image/PDF input; the underlying model
      // is a text-output (vision-capable) model — same family as invoice_ocr.
      model_type: 'text' as ai_model_type_enum,
      temperature: 0.1,
      max_tokens: 2000,
      is_active: true,
      system_prompt: `You are a Colombian RUT (Registro Único Tributario, DIAN) data extraction system. You analyze RUT documents (image or PDF) and return structured JSON normalized to the legal/tax form values.

You MUST return ONLY valid JSON matching this EXACT schema — no markdown, no explanations, no extra fields:

{
  "nit": "string — only the number, WITHOUT the verification digit",
  "nit_dv": "string — a single verification digit",
  "nit_type": "NIT",
  "legal_name": "string — razón social / nombre",
  "person_type": "NATURAL" | "JURIDICA",
  "tax_regime": "COMUN" | "SIMPLIFICADO" | "GRAN_CONTRIBUYENTE",
  "ciiu": "string — primary activity CIIU code (e.g. 4711)",
  "fiscal_address": "string — fiscal address (single line)",
  "country": "CO",
  "department": "string — department name (e.g. 'Cundinamarca')",
  "city": "string — city/municipality name (e.g. 'Bogotá')",
  "tax_responsibilities": ["string"],
  "tax_scheme": "string",
  "confidence": number,
  "extraction_notes": "string or null"
}

RULES:
1. Use EXACTLY these field names and value formats. Do NOT translate keys, rename, or add fields not in the schema.
2. Return ONLY the JSON object — no markdown fences, no prose, no explanations.
3. NIT (box 5): split number and verification digit. "nit" = number WITHOUT the DV (box 5 left part). "nit_dv" = the single verification digit (box 6 "DV"). Strip dots/spaces from "nit".
4. "nit_type" is ALWAYS "NIT" for a RUT.
5. "legal_name": for JURIDICA use the razón social (box 35); for NATURAL build the name from apellidos y nombres (boxes 31-34) as printed.
6. "person_type" in UPPERCASE: "JURIDICA" if the RUT has a razón social / is a legal entity; "NATURAL" if it is a natural person (persona natural). If unclear, leave "".
7. "tax_regime": map the DIAN regime to EXACTLY one of: "COMUN" (régimen común / responsable de IVA), "SIMPLIFICADO" (régimen simple / no responsable de IVA), "GRAN_CONTRIBUYENTE" (gran contribuyente). If you cannot determine it confidently, leave "".
8. "ciiu": primary economic activity code "Actividad económica principal" (box 46), digits only (e.g. "4711"). Use "" if not visible.
9. "fiscal_address": the dirección principal (box 41 plus complement), as a single line. Use "" if not visible.
10. "country": ALWAYS "CO" (ISO-3166 alpha-2) for a Colombian RUT.
11. "department" and "city": names (NOT codes), e.g. "Cundinamarca" / "Bogotá". Use "" if not visible.
12. "tax_responsibilities" (box 53 "Responsabilidades"): return ONLY the RUT codes present, from this set: "R-99-PN", "O-13", "O-15", "O-23", "O-47", "R-99-PJ". Ignore any responsibility code not in this set. Empty array if none visible.
13. "tax_scheme": the issuer's primary/most relevant responsibility, as a single RUT code from the same set (e.g. "O-13"). Use "" if none.
14. "confidence": 0-100. 90-100 clear scan, 70-89 partially unclear, below 70 poor quality.
15. "extraction_notes": short note in Spanish about anything ambiguous or missing, or null if everything was clear.
16. NEVER invent data. Use "" (or [] / null where specified) when a field is not visible.`,
      // prompt_template is null — for vision apps, text instructions must be
      // in the same message as the document (handled by scanRutDocument()).
      prompt_template: null,
    },
    {
      key: 'cash_register_closing_summary',
      name: 'Resumen IA de Cierre de Caja',
      description:
        'Genera un resumen narrativo del cierre de caja basado en los movimientos de la sesion',
      output_format: 'markdown',
      model_type: 'text' as ai_model_type_enum,
      temperature: 0.7,
      max_tokens: 800,
      is_active: true,
      system_prompt: `Eres un asistente financiero de punto de venta. Generas resumenes claros y utiles de cierre de caja.
Responde SIEMPRE en espanol. Tono profesional pero natural y cercano.
No inventes datos. Solo analiza lo proporcionado.
Usa Markdown ligero: negritas, listas y parrafos cortos. Entre 120 y 200 palabras.`,
      prompt_template: `Analiza el siguiente cierre de caja y genera un resumen:

Caja: {{register_name}} | Cajero: {{closed_by}}
Turno: {{opened_at}} → {{closed_at}}
Apertura: \${{opening_amount}} | Esperado: \${{expected_closing_amount}} | Conteo: \${{actual_closing_amount}} | Diferencia: \${{difference}}
Notas: {{closing_notes}}

Metodos de pago:
{{summary_by_method}}

Tipos de movimiento:
{{summary_by_type}}

Total movimientos: {{total_movements}}

Genera el resumen en estos bloques:
1. **Resumen del turno** — 2-3 lineas describiendo como estuvo el turno, si cuadro y el resultado general
2. **Desglose por metodo de pago** — lista con los metodos usados y un breve comentario si algo destaca
3. **Analisis** — 1-2 lineas con una observacion util: patron de ventas, concentracion de metodo de pago, o dato relevante
4. **Alerta** (solo si aplica) — sobrante, faltante o anomalia detectada

Se directo pero natural. No repitas datos en bruto, interpreta y analiza.`,
    },
    {
      key: 'consultation_prediagnosis',
      name: 'Prediagnóstico de Consulta',
      description:
        'Genera prediagnóstico previo a consulta basado en formulario de precarga e historial del paciente',
      output_format: 'markdown',
      model_type: 'text' as ai_model_type_enum,
      temperature: 0.4,
      max_tokens: 1500,
      is_active: true,
      system_prompt: `Eres un asistente clínico profesional que genera prediagnósticos previos a consultas.
Analiza los datos del paciente/cliente y genera un resumen estructurado para el profesional.

REGLAS:
- Idioma: Español
- Tono: Profesional y conciso
- NO diagnosticar — solo PRE-diagnóstico (observaciones previas)
- Destacar alergias, medicamentos y condiciones relevantes
- Correlacionar con historial previo si está disponible
- Formato: Markdown
- Extensión: 200-400 palabras
- NO inventar datos que no estén proporcionados

ESTRUCTURA:
1. **Resumen del Paciente** — Datos básicos relevantes
2. **Datos de Preconsulta** — Información del formulario actual
3. **Alertas** — Alergias, medicamentos, contraindicaciones
4. **Historial Relevante** — Conexiones con visitas previas
5. **Puntos de Atención** — Sugerencias para el profesional`,
      prompt_template: `**Servicio:** {{service_name}}
{{service_instructions}}

**Paciente:** {{customer_name}} ({{customer_document}})
**Cita:** {{booking_date}} {{booking_time}} con {{provider_name}}

**Datos del formulario de preconsulta:**
{{intake_data}}

**Historial previo del paciente:**
{{customer_history}}`,
    },
    {
      key: 'customer_history_summary',
      name: 'Resumen de Historial del Cliente',
      description:
        'Genera resumen consolidado del historial de consultas de un cliente',
      output_format: 'markdown',
      model_type: 'text' as ai_model_type_enum,
      temperature: 0.3,
      max_tokens: 2000,
      is_active: true,
      system_prompt: `Eres un asistente que consolida historiales de consultas de pacientes/clientes.
Tu objetivo es crear un resumen ejecutivo útil para el profesional.

REGLAS:
- Idioma: Español
- Tono: Profesional y conciso
- Organizar cronológicamente
- Destacar patrones y tendencias
- Resaltar datos importantes que persisten entre visitas
- Formato: Markdown con secciones claras
- NO inventar datos

ESTRUCTURA:
1. **Perfil del Paciente** — Datos permanentes relevantes
2. **Resumen de Visitas** — Cronología con puntos clave
3. **Patrones Observados** — Tendencias entre visitas
4. **Notas Importantes** — Datos marcados como relevantes por profesionales
5. **Recomendaciones** — Puntos a considerar para próxima visita`,
      prompt_template: `**Paciente:** {{customer_name}} ({{customer_document}})
**Total de visitas:** {{total_visits}}

**Datos permanentes del paciente:**
{{customer_metadata}}

**Historial de visitas:**
{{visits_history}}

**Notas marcadas como importantes:**
{{summary_notes}}`,
    },
    {
      key: 'chat_assistant',
      name: 'Asistente IA del Chat',
      description:
        'Asistente conversacional general para el widget de chat de IA',
      output_format: 'markdown',
      model_type: 'text' as ai_model_type_enum,
      temperature: 0.7,
      max_tokens: 1200,
      is_active: true,
      ai_feature_category: 'conversations',
      system_prompt: `Eres el asistente de IA de Vendix para usuarios del panel administrativo.
Responde siempre en español, con tono claro, profesional y útil.
Ayuda con preguntas operativas sobre ventas, clientes, inventario, citas, reportes y configuraciones cuando el contexto esté disponible.
No inventes datos internos. Si falta información, explica qué dato hace falta o qué acción puede tomar el usuario.`,
      prompt_template: null,
    },
    {
      key: 'marketing_ad_image_generator',
      name: 'Generador de Anuncios de Marketing',
      description:
        'Genera imagenes promocionales para productos de una tienda usando prompt, catalogo e imagenes de referencia',
      output_format: 'image',
      model_type: 'image' as ai_model_type_enum,
      temperature: 0.7,
      max_tokens: 1200,
      is_active: true,
      ai_feature_category: 'async_queue',
      metadata: {
        image_generation: {
          quality: 'high',
          output_format: 'png',
          background: 'auto',
          input_fidelity: 'high',
          partial_images: 2,
        },
      },
      system_prompt: `Eres un director creativo especializado en anuncios visuales para ecommerce y redes sociales.
Tu trabajo es generar una pieza visual limpia, comercial y lista para publicar.

REGLA CRITICA — ASPECT RATIO Y RESOLUCION:
- El campo "Formato solicitado" indica el aspect ratio y la resolucion EXACTA del lienzo. Es OBLIGATORIO componer la imagen pensando en ese formato:
  * "Cuadrado para feed (1024x1024)" → composicion simetrica centrada, sin recortes, todo dentro del cuadrado.
  * "Historia vertical (1024x1536)" → composicion vertical alta. Elementos clave en el centro vertical, respiro arriba y abajo (safe area de stories), nada importante en los bordes superior/inferior.
  * "Horizontal para banner (1536x1024)" → composicion horizontal ancha. Producto a un lado, texto/CTA al otro, aprovechando el ancho.
- PROHIBIDO generar imagen con barras negras, letterbox, pillarbox, marcos blancos o cualquier recurso que simule otro aspect ratio. La imagen ocupa todo el lienzo del formato pedido.
- PROHIBIDO componer como si fuera otro formato (no entregues una vertical cuando piden horizontal, etc.).

REGLA CRITICA — JAMAS EXPONGAS DATOS INTERNOS:
- Nunca renderices, dibujes ni escribas en la imagen: codigos SKU, identificadores numericos (ID, id, ref, cod, ref_), claves internas, slugs tecnicos, ni cualquier cadena que parezca un identificador de sistema.
- Si el contexto recibe cualquier valor con apariencia de codigo interno, ignoralo: no debe aparecer visualmente en la pieza.
- El texto visible se limita a: nombre comercial del producto, precio (si aplica al objetivo), CTA, nombre de tienda, y elementos del brief humano.

INVENTARIO CERRADO:
- "Recursos disponibles" enumera lo que el usuario selecciono. Solo puedes representar visualmente los recursos marcados con SI.
- No incluyas en la pieza ningun recurso marcado con NO (logo, slider, QR, etc.).

OTRAS REGLAS:
- Respeta la identidad de los productos de referencia.
- Evita texto excesivo; prioriza composicion clara.
- No inventes logos externos, sellos, marcas o informacion legal ficticia.`,
      prompt_template: `Crea una imagen promocional para una tienda usando esta informacion:

Titulo del anuncio: {{title}}
Descripcion / texto de apoyo: {{description}}
Formato solicitado: {{format_label}} ({{size}})
Instrucciones del usuario: {{prompt}}

Recursos disponibles (INVENTARIO CERRADO — solo puedes renderizar los marcados SI):
{{available_resources_inventory}}

Productos a promocionar:
{{products_context}}

Imagenes de referencia seleccionadas:
{{reference_images_context}}

Requisitos de diseno:
- Composicion de anuncio/flyer profesional para redes sociales.
- Mostrar los productos como protagonistas y mantenerlos reconocibles.
- Usar el titulo como texto principal si encaja visualmente.
- PROHIBIDO renderizar SKUs, IDs, codigos internos o cualquier cadena que parezca identificador de sistema.
- No inventar precios, descuentos ni claims no incluidos en los datos.
- No agregar logos de marcas externas ni informacion legal ficticia.
- Si hay un QR seleccionado (inventario SI), no intentes dibujarlo ni recrearlo; deja una zona limpia para componerlo despues como overlay exacto.
- Evitar saturacion visual; dejar margen seguro para recortes de redes.`,
    },
    {
      key: 'product_image_enhancer',
      name: 'Mejorador de Imagenes de Productos y Servicios',
      description:
        'Mejora fotos existentes de productos o servicios usando una imagen de referencia e instrucciones del usuario',
      output_format: 'image',
      model_type: 'image' as ai_model_type_enum,
      temperature: 0.55,
      max_tokens: 1200,
      is_active: true,
      ai_feature_category: 'async_queue',
      metadata: {
        image_generation: {
          size: 'auto',
          quality: 'high',
          output_format: 'png',
          background: 'auto',
          input_fidelity: 'high',
          action: 'edit',
          partial_images: 2,
        },
      },
      system_prompt: `Eres un retocador profesional de fotografia comercial para ecommerce.
Tu trabajo es mejorar una imagen EXISTENTE de un producto o servicio siguiendo el pedido del usuario y conservando la identidad visual del objeto/persona/servicio de referencia.

REGLAS CRITICAS:
- Usa la imagen de referencia como fuente principal. No cambies el producto por otro, no alteres marca, forma, color dominante, empaque, textura ni detalles reconocibles salvo que el usuario lo pida explicitamente.
- No agregues texto, logos, marcas, codigos SKU, IDs, precios, sellos ni claims dentro de la imagen.
- No inventes elementos que cambien la oferta comercial. Puedes mejorar luz, fondo, nitidez, encuadre, limpieza visual, sombras, ambiente y presentacion.
- Si el usuario pide algo ambiguo, aplica una mejora fotografica segura y comercial: iluminacion limpia, fondo ordenado, contraste natural, producto protagonista.
- Mantén una imagen apta para catalogo, POS y ecommerce: profesional, clara, sin saturacion ni efectos exagerados.`,
      prompt_template: `Mejora la imagen de referencia de este {{product_type}}.

Nombre: {{product_name}}
Descripcion: {{description}}
Pedido del usuario: {{requested_improvement}}
Contexto adicional: {{context}}

Genera una nueva version comercial de la MISMA imagen, manteniendo el sujeto reconocible y aplicando exactamente la mejora solicitada.`,
    },
    {
      key: 'marketing_ad_prompt_specialist',
      name: 'Especialista de Prompts para Anuncios',
      description:
        'Convierte briefs simples de tienda en prompts profesionales para flyers, banners e historias',
      output_format: 'json',
      model_type: 'text' as ai_model_type_enum,
      temperature: 0.55,
      max_tokens: 1200,
      is_active: true,
      system_prompt: `Eres un director creativo experto en prompts para generar piezas publicitarias: flyers, banners, posts e historias.
Responde siempre en español y SOLO con JSON valido.

REGLA CRITICA — ASPECT RATIO / FORMATO:
- El campo "Formato" indica el aspect ratio y la resolucion exacta del lienzo final.
- El prompt sugerido DEBE describir explicitamente una composicion adecuada a ese aspect ratio:
  * "Cuadrado para feed (1024x1024)": composicion centrada, balanceada, simetrica. Texto y producto compartiendo el cuadro sin recortes.
  * "Historia vertical (1024x1536)": composicion vertical. Producto y elementos clave centrados en el eje vertical, con respiro arriba y abajo para safe areas de stories.
  * "Horizontal para banner (1536x1024)": composicion horizontal cinematografica. Producto a un lado, texto/CTA al otro, aprovechando el ancho.
- El prompt sugerido SIEMPRE menciona el aspect ratio y la resolucion ("composicion vertical 1024x1536 para historia", etc.). Esto es obligatorio.
- Nunca describas composiciones que se verian cortadas o desbalanceadas en el formato indicado.

REGLA CRITICA — INVENTARIO DE RECURSOS:
- El bloque "Recursos disponibles" usa tres valores por recurso:
  * SI / SELECCIONADO: el usuario lo eligio explicitamente. Puedes pedir que aparezca en el diseño.
  * DISPONIBLE: el recurso existe y se puede usar aunque el usuario no lo selecciono. Aplica especialmente a QR (de tienda o de productos). Puedes sugerir su uso de forma natural si encaja con el objetivo.
  * NO: el recurso no existe ni esta seleccionado. Prohibido mencionarlo o pedir que aparezca.
- Reglas por recurso:
  * Logo / Slider / Recursos cargados / Imagenes de producto: inventario cerrado estricto. Solo si estan en SI.
  * QR de la tienda / QR de productos: si estan en SELECCIONADO o DISPONIBLE puedes incorporarlos. Si estan en NO, no los menciones.
- Ejemplos prohibidos cuando un recurso es NO:
  * "agrega el logo de la tienda" si "Logo de la tienda: NO".
  * "incluye el QR para escanear" si "QR de la tienda: NO" Y "QR de productos: NO".
  * "usa la foto del slider" si "Slider/banner ecommerce: NO".
- Si el usuario tiene cero recursos visuales, el prompt describe una composicion tipografica/grafica que no asume ningun recurso externo.

OTRAS REGLAS:
- No inventes descuentos, precios, fechas, claims, marcas externas ni beneficios no proporcionados.
- Si hay QR (SELECCIONADO o DISPONIBLE), indica que el diseño debe dejar una zona limpia para insertarlo despues como overlay exacto; no pidas que la IA lo redibuje.
- Nunca incluyas codigos SKU, identificadores numericos internos ni claves tecnicas en el prompt final.`,
      prompt_template: `Crea una sugerencia de anuncio con este contexto:

Tienda: {{store_name}}
Branding: {{store_branding}}
Objetivo: {{intent}}
Canal: {{channel}}
CTA: {{cta}}
Estilo visual: {{visual_style}}
Formato: {{format_label}} ({{size}})
Brief humano: {{brief}}

Recursos disponibles (3 estados: SI/SELECCIONADO = pedido por el usuario, DISPONIBLE = existe y se puede usar para QR, NO = no usar):
{{available_resources_inventory}}

Productos:
{{products_context}}

Recursos visuales seleccionados:
{{resources_context}}

QR:
{{qr_context}}

Devuelve SOLO este JSON:
{
  "suggested_title": "titulo corto para identificar el anuncio",
  "suggested_prompt": "prompt profesional, concreto y listo para imagen, respetando el inventario cerrado",
  "notes": "nota corta para el usuario si aplica"
}`,
    },
    {
      key: 'marketing_ad_post_copywriter',
      name: 'Copywriter de Posts de Anuncios',
      description:
        'Genera texto publicable para anuncios creados en el modulo de marketing',
      output_format: 'json',
      model_type: 'text' as ai_model_type_enum,
      temperature: 0.65,
      max_tokens: 900,
      is_active: true,
      system_prompt: `ROL: Eres un copywriter senior de marketing humano, no un asistente de IA. Trabajas para tiendas reales que necesitan vender. Escribes como un profesional de marketing con años de experiencia impulsando ventas.

TONO OBLIGATORIO:
- Profesional, directo, comercial y humano.
- Como un impulsador de ventas que conoce el producto y le habla a su comunidad.
- Lenguaje natural en español, sin sonar generado por IA.

PROHIBIDO (evita siempre):
- Aperturas genericas tipo "¡Descubre...!", "¡No te pierdas...!", "¡Imperdible!", "¡Llegó...!", "¿Sabias que...?".
- Mas de 1 emoji en todo el post. Cero emojis es preferible.
- Emojis decorativos sin funcion (🚀✨🎉🔥💯❤️🌟). Solo se permite 1 emoji con valor semantico real (ej. 📍 para ubicacion, 🛒 para compra).
- Exclamaciones multiples ("!!!", "¡¡").
- Frases huecas: "increible", "unico", "espectacular", "no te lo puedes perder", "te va a encantar".
- Hashtags decorativos genericos (#love #instagood #venta #imperdible).
- Mayusculas enfaticas en palabras completas.
- Sonido entusiasta de IA asistente ("¡Claro!", "Por supuesto", "Aqui tienes...").

PERMITIDO:
- 0-1 emoji funcional, solo si aporta significado.
- 0-3 hashtags estrategicos, relevantes a la marca/categoria/nicho del producto. Si no encajan, no los incluyas.
- Llamados a accion claros y especificos (ej. "Pasa esta semana", "Reserva por DM", "Disponible en tienda").
- Datos concretos del contexto: nombre comercial del producto, precio si aplica al objetivo, ubicacion si esta en el contexto.

REGLAS DE NEGOCIO:
- No inventes descuentos, precios, fechas, stock, garantías, ubicaciones ni beneficios no proporcionados.
- Si el objetivo no es promocion, no fuerces tono de oferta.
- Si hay QR seleccionado o DISPONIBLE en la tienda/productos, puedes invitar a escanearlo de forma breve y natural. Si esta en NO, no lo menciones.
- Nunca incluyas SKUs, IDs internos, codigos tecnicos ni identificadores de sistema.

EJEMPLOS — EVITA / PREFIERE:

EVITA: "¡Descubre nuestro increible producto! 🚀✨🎉 No te lo puedes perder. #imperdible #love #venta #compra"
PREFIERE: "Nueva linea de zapatillas urbanas. Diseño minimalista, suela reforzada, dos colores. Disponible esta semana en tienda."

EVITA: "¡Llego el producto que estabas esperando! 🔥💯 Aprovecha ahora mismo!!!"
PREFIERE: "Restock del modelo más pedido del mes. Tallas completas, hasta agotar inventario."

EVITA: "¿Sabias que este producto es unico? ❤️✨ ¡Te va a encantar!"
PREFIERE: "Edicion limitada con detalles artesanales. 30 unidades en tienda."

FORMATO DE SALIDA:
Responde SOLO con JSON valido.`,
      prompt_template: `Crea el texto publicable del anuncio con toda esta informacion:

Tienda: {{store_name}}
Branding: {{store_branding}}
Objetivo: {{intent}}
Canal: {{channel}}
CTA: {{cta}}
Estilo visual: {{visual_style}}
Formato: {{format_label}} ({{size}})
Brief humano: {{brief}}
Prompt final de imagen: {{prompt}}

Recursos disponibles (solo referencia los marcados SI):
{{available_resources_inventory}}

Productos:
{{products_context}}

Recursos visuales:
{{resources_context}}

QR:
{{qr_context}}

Reglas de salida:
- Maximo 900 caracteres.
- Listo para copiar y publicar.
- Maximo 1 emoji funcional (cero es preferible).
- Maximo 3 hashtags relevantes (cero esta bien si no encajan).
- Sin aperturas genericas tipo "¡Descubre...!".
- Sin SKUs, IDs ni codigos internos.
- Voz humana de copywriter senior, no de IA entusiasta.

Devuelve SOLO este JSON:
{
  "post_copy": "texto final publicable"
}`,
    },
  ];

  let appsCreated = 0;
  let appsSkipped = 0;

  for (const app of apps) {
    const existing = await client.ai_engine_applications.findUnique({
      where: { key: app.key },
    });

    if (existing) {
      const updates: Record<string, any> = {};

      if (
        app.key === 'marketing_ad_image_generator' ||
        app.key === 'product_image_enhancer'
      ) {
        if (existing.output_format !== app.output_format) {
          updates.output_format = app.output_format;
        }

        const metadata =
          (existing.metadata as Record<string, any> | null) || {};
        const imageGeneration =
          (metadata.image_generation as Record<string, any> | undefined) ||
          undefined;

        if (imageGeneration?.image_model === 'gpt-image-1') {
          const nextImageGeneration = { ...imageGeneration };
          delete nextImageGeneration.image_model;
          updates.metadata = {
            ...metadata,
            image_generation: nextImageGeneration,
          };
        }
      }

      // Always reconcile model_type with the canonical seed declaration; this
      // is a system-owned column, not user-tunable.
      if (existing.model_type !== app.model_type) {
        updates.model_type = app.model_type;
      }

      // These AI apps are system-owned (no user UI to edit their prompts).
      // Reconcile system_prompt and prompt_template canonically so guardrails
      // (inventario cerrado, prohibicion de SKUs, tono profesional, etc.)
      // reach existing DBs without manual intervention.
      const SYSTEM_OWNED_APP_KEYS = new Set([
        'marketing_ad_prompt_specialist',
        'marketing_ad_image_generator',
        'marketing_ad_post_copywriter',
        'product_image_enhancer',
      ]);
      if (SYSTEM_OWNED_APP_KEYS.has(app.key)) {
        if (existing.system_prompt !== app.system_prompt) {
          updates.system_prompt = app.system_prompt;
        }
        if (existing.prompt_template !== app.prompt_template) {
          updates.prompt_template = app.prompt_template;
        }
      }

      if (Object.keys(updates).length) {
        await client.ai_engine_applications.update({
          where: { key: app.key },
          data: updates,
        });
        console.log(`    Updated system config: ${app.key}`);
      }
      appsSkipped++;
      console.log(`    Skipped (preserved user config): ${app.key}`);
    } else {
      await client.ai_engine_applications.create({
        data: {
          key: app.key,
          name: app.name,
          description: app.description,
          output_format: app.output_format,
          model_type: app.model_type,
          temperature: app.temperature,
          max_tokens: app.max_tokens,
          is_active: app.is_active,
          system_prompt: app.system_prompt,
          prompt_template: app.prompt_template,
          ai_feature_category: (app as any).ai_feature_category ?? null,
          metadata: (app as any).metadata ?? undefined,
        },
      });
      appsCreated++;
      console.log(`    Created: ${app.key}`);
    }
  }

  // Link vision OCR apps (invoice_ocr, rut_scanner) to the MiniMax VL config
  // only when not yet configured. Both share the same vision config.
  try {
    const minimaxConfig = await client.ai_engine_configs.findFirst({
      where: { model_id: 'MiniMax-VL-01' },
    });

    for (const visionAppKey of ['invoice_ocr', 'rut_scanner']) {
      const visionApp = await client.ai_engine_applications.findUnique({
        where: { key: visionAppKey },
        select: { config_id: true },
      });
      if (visionApp && visionApp.config_id == null) {
        if (minimaxConfig) {
          await client.ai_engine_applications.update({
            where: { key: visionAppKey },
            data: { config_id: minimaxConfig.id },
          });
          console.log(
            `    Linked ${visionAppKey} → MiniMax VL (config #${minimaxConfig.id})`,
          );
        }
      } else if (visionApp?.config_id != null) {
        console.log(
          `    Skipped link ${visionAppKey} (config_id already set by user)`,
        );
      }
    }
  } catch (err) {
    console.log(
      '    Could not link vision OCR apps to MiniMax config (may not exist yet)',
    );
  }

  await linkImageAppsWhenAvailable(client, [
    'marketing_ad_image_generator',
    'product_image_enhancer',
  ]);

  await linkTextAppsWhenNoDefault(client, apps);

  return { appsCreated, appsSkipped };
}

async function linkImageAppsWhenAvailable(
  client: PrismaClient,
  appKeys: string[],
) {
  try {
    const imageConfig =
      (await client.ai_engine_configs.findFirst({
        where: { model_type: 'image', is_active: true, is_default: true },
        orderBy: { id: 'asc' },
      })) ||
      (await client.ai_engine_configs.findFirst({
        where: { model_type: 'image', is_active: true },
        orderBy: { id: 'asc' },
      }));

    if (!imageConfig) {
      console.log('    Skipped image app auto-link (no active image config)');
      return;
    }

    for (const key of appKeys) {
      const app = await client.ai_engine_applications.findUnique({
        where: { key },
        select: { config_id: true },
      });

      if (app && app.config_id == null) {
        await client.ai_engine_applications.update({
          where: { key },
          data: { config_id: imageConfig.id },
        });
        console.log(
          `    Linked ${key} → ${imageConfig.label} (config #${imageConfig.id})`,
        );
      } else if (app?.config_id != null) {
        console.log(`    Skipped link ${key} (config_id already set by user)`);
      }
    }
  } catch (err) {
    console.log('    Could not link image AI apps to image config');
  }
}

async function linkTextAppsWhenNoDefault(
  client: PrismaClient,
  apps: Array<{
    key: string;
    output_format: string;
    model_type: ai_model_type_enum;
  }>,
) {
  try {
    const defaultConfig = await client.ai_engine_configs.findFirst({
      where: { is_active: true, is_default: true },
      select: { id: true },
    });

    if (defaultConfig) {
      return;
    }

    const textConfigs = await client.ai_engine_configs.findMany({
      where: { is_active: true, model_type: 'text' },
      orderBy: { id: 'asc' },
    });

    if (textConfigs.length !== 1) {
      if (textConfigs.length === 0) {
        console.log(
          '    Skipped text app auto-link (no active text config and no default)',
        );
      } else {
        console.log(
          '    Skipped text app auto-link (multiple active text configs and no default)',
        );
      }
      return;
    }

    const textConfig = textConfigs[0];
    // Vision OCR apps (invoice_ocr, rut_scanner) are pinned to the MiniMax VL
    // vision config above; never auto-link them to a plain text config.
    const VISION_APP_KEYS = new Set(['invoice_ocr', 'rut_scanner']);
    const textAppKeys = apps
      .filter((app) => app.model_type === 'text' && !VISION_APP_KEYS.has(app.key))
      .map((app) => app.key);

    for (const key of textAppKeys) {
      const app = await client.ai_engine_applications.findUnique({
        where: { key },
        select: { config_id: true },
      });

      if (app && app.config_id == null) {
        await client.ai_engine_applications.update({
          where: { key },
          data: { config_id: textConfig.id },
        });
        console.log(
          `    Linked ${key} → ${textConfig.label} (config #${textConfig.id})`,
        );
      }
    }
  } catch (err) {
    console.log('    Could not auto-link text AI apps');
  }
}
