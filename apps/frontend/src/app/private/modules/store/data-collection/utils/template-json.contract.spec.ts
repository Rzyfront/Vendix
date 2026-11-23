import {
  buildExampleTemplateJson,
  checkDocumentFile,
  documentAcceptAttribute,
  resolveDocumentConfig,
  TEMPLATE_FIELD_TYPES,
  templateToJson,
  validateTemplateJson,
} from './template-json.contract';

describe('template-json.contract (frontend copy)', () => {
  it('the example is valid and covers every field type, documents included', () => {
    const example = buildExampleTemplateJson();
    expect(validateTemplateJson(JSON.parse(JSON.stringify(example))).ok).toBeTrue();
    const types = new Set(example.sections!.flatMap((s) => s.items!.map((i) => i.field.type)));
    for (const t of TEMPLATE_FIELD_TYPES) expect(types.has(t)).withContext(t).toBeTrue();
  });

  it('reports invalid fields with their path and ignores ids', () => {
    const r = validateTemplateJson({
      id: 1,
      name: 'T',
      sections: [{ id: 2, title: 'S', items: [{ id: 3, field: { key: 'k', type: 'nope', label: 'L' } }] }],
    });
    expect(r.ok).toBeFalse();
    expect(r.errors.map((e) => e.path)).toEqual(['sections[0].items[0].field.type']);

    const ok = validateTemplateJson({
      id: 1,
      name: 'T',
      sections: [{ id: 2, title: 'S', items: [{ metadata_field_id: 9, field: { key: 'k', type: 'text', label: 'L' } }] }],
    });
    expect(ok.ok).toBeTrue();
    expect(JSON.stringify(ok.ok ? ok.value : null)).not.toContain('"id"');
  });

  it('exports a loaded template that validates again', () => {
    const json = templateToJson({
      name: 'X',
      entity_type: 'customer',
      sections: [
        {
          title: 'S',
          items: [{ metadata_field: { field_key: 'f', field_type: 'file', label: 'F', entity_type: 'customer' } }],
        },
      ],
    });
    expect(json.sections![0].items![0].documents).toEqual({ multiple: false, accept: ['pdf', 'image'], max_size_mb: 10 });
    expect(validateTemplateJson(json).ok).toBeTrue();
  });

  it('checks a file against the documents config', () => {
    const config = resolveDocumentConfig({ documents: { accept: ['image'], max_size_mb: 2 } });
    expect(checkDocumentFile(config, { name: 'a.png', mime_type: 'image/png', size: 100 })).toBeNull();
    expect(checkDocumentFile(config, { name: 'a.pdf', mime_type: 'application/pdf', size: 100 })).toContain('no permitido');
    expect(checkDocumentFile(config, { name: 'a.png', mime_type: 'image/png', size: 3 * 1024 * 1024 })).toContain('2 MB');
    expect(documentAcceptAttribute(config)).toContain('.png');
  });
});
