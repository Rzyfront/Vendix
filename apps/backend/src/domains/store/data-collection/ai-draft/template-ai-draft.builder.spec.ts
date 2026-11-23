import { BadRequestException } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  TEMPLATE_BUILDER_APP_KEY,
  TemplateDraftContext,
  TemplateDraftFile,
  buildTemplateDraftFromFiles,
} from './template-ai-draft.builder';
import { TEMPLATE_JSON_SCHEMA } from '../template-json/template-json.schema';
import { TEMPLATE_FIELD_TYPES } from '../template-json/template-json.contract';

const VALID = {
  schema: 'vendix.data-collection-template/v1',
  name: 'Ficha de ingreso',
  entity_type: 'customer',
  sections: [
    {
      title: 'Datos personales',
      items: [
        { field: { key: 'nombre_completo', type: 'text', label: 'Nombre completo' }, width: '50' },
        {
          field: { key: 'documentos', type: 'file', label: 'Documentos / adjuntos' },
          documents: { multiple: true, accept: ['pdf', 'image'], max_size_mb: 10 },
        },
      ],
    },
  ],
};
/** Same draft with an unknown field type: `sections[0].items[0].field.type`. */
const INVALID = {
  ...VALID,
  sections: [{ title: 'Datos personales', items: [{ field: { key: 'nombre', type: 'texto', label: 'Nombre' } }] }],
};

const pdfFile = (): TemplateDraftFile => ({
  buffer: Buffer.from('%PDF-1.7 form'),
  mimeType: 'application/pdf',
  originalName: 'ficha.pdf',
  size: 13,
});

const page = (n: number, text = '') => ({
  page_number: n,
  data_uri: `data:image/jpeg;base64,PAGE${n}`,
  mime_type: 'image/jpeg' as const,
  text,
});

function makeCtx(answers: Array<Record<string, unknown>>, pageCount = 1) {
  const run = jest.fn();
  for (const answer of answers) run.mockResolvedValueOnce(answer);
  const ctx = {
    aiEngine: { run, assertVisionModelLinked: jest.fn().mockResolvedValue(undefined) },
    pages: {
      prepare: jest.fn().mockResolvedValue({
        pages: Array.from({ length: pageCount }, (_, i) => page(i + 1, i === 0 ? 'FICHA DE INGRESO Nombre:' : '')),
        page_count: pageCount,
      }),
    },
  };
  return { ctx: ctx as unknown as TemplateDraftContext & typeof ctx, run };
}

const ok = (content: string, extra: Record<string, unknown> = {}) => ({ success: true, content, ...extra });

describe('buildTemplateDraftFromFiles', () => {
  it('returns the normalized template when the first answer is valid', async () => {
    const { ctx, run } = makeCtx([ok('```json\n' + JSON.stringify(VALID) + '\n```')]);

    const result = await buildTemplateDraftFromFiles([pdfFile()], ctx);

    expect(result.errors).toEqual([]);
    expect(result.json).toMatchObject({ schema: 'vendix.data-collection-template/v1', entity_type: 'customer' });
    expect(run).toHaveBeenCalledTimes(1);
    const [appKey, variables, messages] = run.mock.calls[0];
    expect(appKey).toBe(TEMPLATE_BUILDER_APP_KEY);
    // The schema and the type list come from the contract, not from the prompt text.
    expect(JSON.parse(variables.template_schema)).toEqual(TEMPLATE_JSON_SCHEMA);
    expect(variables.field_types).toBe(TEMPLATE_FIELD_TYPES.join(', '));
    // PDF goes as native text + page image, never as a raw PDF data URI.
    const parts = messages[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.some((p) => p.text?.includes('FICHA DE INGRESO Nombre:'))).toBe(true);
    expect(parts.filter((p) => p.type === 'image_url').map((p) => p.image_url!.url)).toEqual(['data:image/jpeg;base64,PAGE1']);
    expect(JSON.stringify(messages)).not.toContain('application/pdf');
  });

  it('sends at most 3 pages and says how many were left out', async () => {
    const { ctx, run } = makeCtx([ok(JSON.stringify(VALID))], 5);

    await buildTemplateDraftFromFiles([pdfFile()], ctx);

    const parts = run.mock.calls[0][2][0].content as Array<{ type: string; text?: string }>;
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(3);
    expect(parts.some((p) => p.text?.includes('first 3 of 5 pages'))).toBe(true);
  });

  it('repairs once with the errors by path and returns the repaired template', async () => {
    const { ctx, run } = makeCtx([ok(JSON.stringify(INVALID)), ok(JSON.stringify(VALID))]);

    const result = await buildTemplateDraftFromFiles([pdfFile()], ctx);

    expect(result.errors).toEqual([]);
    expect(run).toHaveBeenCalledTimes(2);
    const repairPrompt = run.mock.calls[1][2][0].content as string;
    expect(repairPrompt).toContain('sections[0].items[0].field.type');
    expect(repairPrompt).toContain('"texto"');
  });

  it('returns the JSON with its errors when the repair is still invalid (no dry failure, one repair only)', async () => {
    const { ctx, run } = makeCtx([ok(JSON.stringify(INVALID)), ok(JSON.stringify(INVALID))]);

    const result = await buildTemplateDraftFromFiles([pdfFile()], ctx);

    expect(run).toHaveBeenCalledTimes(2);
    expect(result.json).toEqual(INVALID);
    expect(result.errors.map((e) => e.path)).toContain('sections[0].items[0].field.type');
  });

  it('keeps the first draft and its errors when the repair call fails', async () => {
    const { ctx, run } = makeCtx([ok(JSON.stringify(INVALID))]);
    run.mockRejectedValueOnce(new VendixHttpException(ErrorCodes.SUBSCRIPTION_005));

    const result = await buildTemplateDraftFromFiles([pdfFile()], ctx);

    expect(result.json).toEqual(INVALID);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('repairs a malformed JSON answer once', async () => {
    const { ctx, run } = makeCtx([ok('Aquí está: {"schema": "vendix'), ok(JSON.stringify(VALID))]);

    const result = await buildTemplateDraftFromFiles([pdfFile()], ctx);

    expect(result.errors).toEqual([]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][2][0].content).toContain('Invalid JSON');
  });

  it('fails with DCOL_AI_002 when the answer stays malformed after the repair', async () => {
    const { ctx, run } = makeCtx([ok('no json at all'), ok('still not json')]);

    await expect(buildTemplateDraftFromFiles([pdfFile()], ctx)).rejects.toMatchObject({ errorCode: 'DCOL_AI_002' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('fails with DCOL_AI_003 when the answer is cut by the length limit', async () => {
    const { ctx, run } = makeCtx([ok('{"schema":"vendix.data', { finish_reason: 'length' })]);

    await expect(buildTemplateDraftFromFiles([pdfFile()], ctx)).rejects.toMatchObject({ errorCode: 'DCOL_AI_003' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('propagates AI_VISION_001 and never calls the model when no vision model is linked', async () => {
    const { ctx, run } = makeCtx([]);
    ctx.aiEngine.assertVisionModelLinked.mockRejectedValue(new VendixHttpException(ErrorCodes.AI_VISION_001));

    await expect(buildTemplateDraftFromFiles([pdfFile()], ctx)).rejects.toMatchObject({ errorCode: 'AI_VISION_001' });
    expect(ctx.pages.prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('fails with a clear DCOL_AI_004 when the PDF pages cannot be prepared', async () => {
    const { ctx, run } = makeCtx([]);
    ctx.pages.prepare.mockRejectedValue(new BadRequestException('No se pudo leer el PDF del documento.'));

    const error = await buildTemplateDraftFromFiles([pdfFile()], ctx).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('DCOL_AI_004');
    expect(error.message).toContain('foto del formulario');
    expect(run).not.toHaveBeenCalled();
  });

  it('maps a provider failure to its Vendix code so the queue classifies it', async () => {
    const { ctx } = makeCtx([{ success: false, error_code: 'AI_PROVIDER_003' }]);

    await expect(buildTemplateDraftFromFiles([pdfFile()], ctx)).rejects.toMatchObject({ errorCode: 'AI_PROVIDER_003' });
  });
});
