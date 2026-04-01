import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedAIEngineAppsResult {
  appsCreated: number;
  appsUpdated: number;
}

/**
 * AI Engine Applications Seed
 *
 * Seeds the default AI application definitions used by various features.
 * Uses upsert by unique key to be fully idempotent.
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
  ];

  let appsCreated = 0;
  let appsUpdated = 0;

  for (const app of apps) {
    const existing = await client.ai_engine_applications.findUnique({
      where: { key: app.key },
    });

    if (existing) {
      await client.ai_engine_applications.update({
        where: { key: app.key },
        data: {
          name: app.name,
          description: app.description,
          output_format: app.output_format,
          temperature: app.temperature,
          max_tokens: app.max_tokens,
          is_active: app.is_active,
          system_prompt: app.system_prompt,
          prompt_template: app.prompt_template,
          updated_at: new Date(),
        },
      });
      appsUpdated++;
      console.log(`    Updated: ${app.key}`);
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

  // Link invoice_ocr to MiniMax VL config if available
  try {
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
  } catch (err) {
    console.log('    Could not link invoice_ocr to MiniMax config (may not exist yet)');
  }

  return { appsCreated, appsUpdated };
}
