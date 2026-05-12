import { PrismaClient } from '@prisma/client';
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
      key: 'cash_register_closing_summary',
      name: 'Resumen IA de Cierre de Caja',
      description:
        'Genera un resumen narrativo del cierre de caja basado en los movimientos de la sesion',
      output_format: 'markdown',
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
  ];

  let appsCreated = 0;
  let appsSkipped = 0;

  for (const app of apps) {
    const existing = await client.ai_engine_applications.findUnique({
      where: { key: app.key },
    });

    if (existing) {
      appsSkipped++;
      console.log(`    Skipped (preserved user config): ${app.key}`);
    } else {
      await client.ai_engine_applications.create({
        data: {
          key: app.key,
          name: app.name,
          description: app.description,
          output_format: app.output_format,
          temperature: app.temperature,
          max_tokens: app.max_tokens,
          is_active: app.is_active,
          system_prompt: app.system_prompt,
          prompt_template: app.prompt_template,
        },
      });
      appsCreated++;
      console.log(`    Created: ${app.key}`);
    }
  }

  // Link invoice_ocr to MiniMax VL config only when not yet configured.
  try {
    const invoiceOcrApp = await client.ai_engine_applications.findUnique({
      where: { key: 'invoice_ocr' },
      select: { config_id: true },
    });
    if (invoiceOcrApp && invoiceOcrApp.config_id == null) {
      const minimaxConfig = await client.ai_engine_configs.findFirst({
        where: { model_id: 'MiniMax-VL-01' },
      });
      if (minimaxConfig) {
        await client.ai_engine_applications.update({
          where: { key: 'invoice_ocr' },
          data: { config_id: minimaxConfig.id },
        });
        console.log(`    Linked invoice_ocr → MiniMax VL (config #${minimaxConfig.id})`);
      }
    } else if (invoiceOcrApp?.config_id != null) {
      console.log('    Skipped link invoice_ocr (config_id already set by user)');
    }
  } catch (err) {
    console.log('    Could not link invoice_ocr to MiniMax config (may not exist yet)');
  }

  return { appsCreated, appsSkipped };
}
