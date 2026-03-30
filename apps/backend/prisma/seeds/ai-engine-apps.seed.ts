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
      system_prompt: `Eres un asistente especializado en extraer datos de facturas de compra colombianas. Tu tarea es analizar la imagen de una factura y extraer todos los datos relevantes en formato JSON estructurado.

Reglas importantes:
1. Los numeros en facturas colombianas usan punto como separador de miles y coma como separador decimal (ej: 1.234.567,89). SIEMPRE convierte estos valores a formato numerico estandar (ej: 1234567.89).
2. El NIT (Numero de Identificacion Tributaria) puede aparecer como "NIT", "N.I.T.", "Nit" o similar. Incluye el digito de verificacion si esta presente.
3. El IVA en Colombia es generalmente del 19%. Identifica correctamente el valor del IVA.
4. Si un campo no es legible o no esta presente, usa null en lugar de inventar datos.
5. La confianza (confidence) debe reflejar tu seguridad general en la extraccion (0-100).
6. SIEMPRE retorna JSON valido, sin markdown, sin texto adicional.`,
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

  return { appsCreated, appsUpdated };
}
