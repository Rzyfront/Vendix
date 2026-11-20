import {
  buildExampleTemplateJson,
  checkDocumentFile,
  documentAcceptAttribute,
  readStoredDocuments,
  resolveDocumentConfig,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_JSON_SCHEMA_ID,
  templateToJson,
  validateTemplateJson,
} from './template-json.contract';

const minimal = () => ({
  schema: TEMPLATE_JSON_SCHEMA_ID,
  name: 'Ingreso',
  sections: [
    {
      title: 'Datos',
      items: [{ field: { key: 'placa', type: 'text', label: 'Placa' } }],
    },
  ],
});

describe('validateTemplateJson', () => {
  it('accepts a minimal template and fills the entity type', () => {
    const r = validateTemplateJson(minimal());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.entity_type).toBe('booking');
      expect(r.value.sections?.[0].items?.[0].field).toEqual({
        key: 'placa',
        type: 'text',
        label: 'Placa',
      });
    }
  });

  it('drops internal ids so an import always creates new records', () => {
    const json: any = minimal();
    json.id = 99;
    json.store_id = 7;
    json.sections[0].id = 5;
    json.sections[0].template_id = 99;
    json.sections[0].items[0].id = 3;
    json.sections[0].items[0].metadata_field_id = 42;
    json.sections[0].items[0].field.id = 42;
    const r = validateTemplateJson(json);
    expect(r.ok).toBe(true);
    const text = JSON.stringify(r.ok ? r.value : null);
    expect(text).not.toMatch(/"id"|store_id|template_id|metadata_field_id/);
  });

  it('reports each invalid field with its path', () => {
    const r = validateTemplateJson({
      name: '',
      sections: [
        {
          title: 'Datos',
          items: [
            { field: { key: 'a b', type: 'foo', label: '' } },
            { field: { key: 'motivo', type: 'select', label: 'Motivo' } },
            { field: { key: 'doc', type: 'file', label: 'Doc' }, documents: { accept: ['exe'], max_size_mb: 99 } },
            { field: { key: 'x', type: 'text', label: 'X' }, width: '40' },
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'name',
        'sections[0].items[0].field.key',
        'sections[0].items[0].field.type',
        'sections[0].items[0].field.label',
        'sections[0].items[1].field.options',
        'sections[0].items[2].documents.accept',
        'sections[0].items[2].documents.max_size_mb',
        'sections[0].items[3].width',
      ]),
    );
    const typeError = r.errors.find((e) => e.path === 'sections[0].items[0].field.type');
    expect(typeError?.message).toContain('"foo"');
  });

  it('rejects the same field twice, tabs together with sections and a missing structure', () => {
    const dup = minimal() as any;
    dup.sections[0].items.push({ field: { key: 'placa', type: 'text', label: 'Otra' } });
    expect(validateTemplateJson(dup).errors.map((e) => e.path)).toContain('sections[0].items[1].field.key');

    const both = minimal() as any;
    both.tabs = [{ title: 'Paso', sections: [{ title: 'S' }] }];
    expect(validateTemplateJson(both).errors.map((e) => e.path)).toContain('tabs');

    expect(validateTemplateJson({ name: 'Vacía' }).errors.map((e) => e.path)).toContain('sections');
    expect(validateTemplateJson('nope').ok).toBe(false);
    expect(validateTemplateJson({ ...minimal(), schema: 'other/v9' }).errors.map((e) => e.path)).toContain('schema');
  });

  it('rejects documents config on a non-file field and grandchild sections', () => {
    const r = validateTemplateJson({
      name: 'T',
      sections: [
        {
          title: 'A',
          items: [{ field: { key: 'n', type: 'text', label: 'N' }, documents: { multiple: true } }],
          child_sections: [{ title: 'B', child_sections: [{ title: 'C' }] }],
        },
      ],
    });
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain('sections[0].items[0].documents');
    expect(paths).toContain('sections[0].child_sections[0].child_sections');
  });

  it('gives a file field the default documents config', () => {
    const r = validateTemplateJson({
      name: 'T',
      sections: [{ title: 'A', items: [{ field: { key: 'f', type: 'file', label: 'F' } }] }],
    });
    expect(r.ok && r.value.sections?.[0].items?.[0].documents).toEqual({
      multiple: false,
      accept: ['pdf', 'image'],
      max_size_mb: 10,
    });
  });
});

describe('buildExampleTemplateJson', () => {
  it('is valid and uses every field type, documents included', () => {
    const example = buildExampleTemplateJson();
    const r = validateTemplateJson(JSON.parse(JSON.stringify(example)));
    expect(r.ok).toBe(true);
    const types = new Set(example.sections!.flatMap((s) => s.items!.map((i) => i.field.type)));
    for (const t of TEMPLATE_FIELD_TYPES) expect(types.has(t)).toBe(true);
  });
});

describe('templateToJson', () => {
  it('exports a loaded template without ids and re-imports it', () => {
    const json = templateToJson({
      name: 'Ingreso',
      entity_type: 'booking',
      tabs: [],
      sections: [
        {
          title: 'Datos',
          sort_order: 0,
          items: [
            {
              sort_order: 1,
              is_required: true,
              width: '50',
              validation_rules: { documents: { multiple: true, accept: ['pdf'], max_size_mb: 5 } },
              metadata_field: { field_key: 'soporte', field_type: 'file', label: 'Soporte', entity_type: 'customer' },
            },
            {
              sort_order: 0,
              metadata_field: { field_key: 'motivo', field_type: 'select', label: 'Motivo', entity_type: 'booking', options: ['A', 'B'] },
            },
          ],
          child_sections: [],
        },
      ],
    });
    expect(json.sections![0].items!.map((i) => i.field.key)).toEqual(['motivo', 'soporte']);
    expect(json.sections![0].items![1]).toEqual({
      field: { key: 'soporte', type: 'file', label: 'Soporte', entity_type: 'customer' },
      required: true,
      width: '50',
      documents: { multiple: true, accept: ['pdf'], max_size_mb: 5 },
    });
    expect(validateTemplateJson(json).ok).toBe(true);
  });
});

describe('documents policy', () => {
  const config = resolveDocumentConfig({ documents: { accept: ['pdf'], max_size_mb: 1 } });

  it('accepts an allowed file and rejects wrong type, wrong extension, empty and oversize', () => {
    expect(checkDocumentFile(config, { name: 'a.pdf', mime_type: 'application/pdf', size: 10 })).toBeNull();
    expect(checkDocumentFile(config, { name: 'a.png', mime_type: 'image/png', size: 10 })).toContain('Tipo de archivo no permitido');
    expect(checkDocumentFile(config, { name: 'a.exe', mime_type: 'application/pdf', size: 10 })).toContain('Tipo de archivo no permitido');
    expect(checkDocumentFile(config, { name: 'a.pdf', mime_type: 'application/pdf', size: 0 })).toContain('vacío');
    expect(checkDocumentFile(config, { name: 'a.pdf', mime_type: 'application/pdf', size: 2 * 1024 * 1024 })).toContain('1 MB');
  });

  it('clamps the size and falls back to defaults on garbage', () => {
    expect(resolveDocumentConfig({ documents: { max_size_mb: 500 } }).max_size_mb).toBe(20);
    expect(resolveDocumentConfig(null)).toEqual({ multiple: false, accept: ['pdf', 'image'], max_size_mb: 10 });
    expect(documentAcceptAttribute(config)).toBe('application/pdf,.pdf');
  });

  it('reads value_json files and the legacy single key', () => {
    expect(
      readStoredDocuments({ value_json: { files: [{ key: 'a/1700000000000-x.pdf', name: 'x.pdf', size: 3, mime_type: 'application/pdf' }, { nope: 1 }] } }),
    ).toEqual([{ key: 'a/1700000000000-x.pdf', name: 'x.pdf', size: 3, mime_type: 'application/pdf' }]);
    expect(readStoredDocuments({ value_text: 'a/b/1700000000000-cedula.pdf' })).toEqual([
      { key: 'a/b/1700000000000-cedula.pdf', name: 'cedula.pdf', size: 0, mime_type: '' },
    ]);
    expect(readStoredDocuments({})).toEqual([]);
  });
});
