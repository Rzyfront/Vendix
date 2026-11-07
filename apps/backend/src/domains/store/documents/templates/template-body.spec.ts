import {
  TemplateBodyError,
  bodyHash,
  tokenSchemaOfBasePdf,
  tokenSchemaOfBlocks,
  validateBasePdfBody,
  validateBlocksBody,
} from './template-body';

const valid = () => ({
  page: { size: 'A4' },
  header: { show_logo: true, text: '{{ store.name }}' },
  footer: { page_numbers: true },
  signature_slots: [
    { key: 'empleador', role_label: 'Empleador' },
    { key: 'empleado', role_label: 'Empleado' },
  ],
  blocks: [
    { type: 'heading', text: 'Contrato', level: 1 },
    { type: 'paragraph', text: 'Para {{ fields.nombre }} por {{ fields.salario | money }}' },
    { type: 'fields', rows: [{ label: 'Cédula', value: "{{ fields.cedula | default:'—' }}" }] },
    { type: 'table', source: 'fields.items', columns: [{ header: 'Ítem', value: '{{ row.name }}' }] },
    { type: 'signature', slot_key: 'empleado' },
  ],
});

const errorsOf = (body: unknown): string[] => {
  try {
    validateBlocksBody(body);
  } catch (e) {
    return (e as TemplateBodyError).errors;
  }
  return [];
};

describe('template body validation', () => {
  it('accepts a complete block body', () => {
    expect(errorsOf(valid())).toEqual([]);
  });

  it('lists every problem with a readable message', () => {
    const body = valid() as any;
    body.page.size = 'A3';
    body.blocks.push({ type: 'signature', slot_key: 'nadie' });
    body.blocks.push({ type: 'html', text: '<b>' });
    body.blocks.push({ type: 'paragraph', text: '{{ fields.x | evil }}' });
    body.blocks.push({ type: 'paragraph', text: '{{ row.name }}' });
    const errors = errorsOf(body);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("page.size"),
        expect.stringContaining("'nadie'"),
        expect.stringContaining("'html'"),
        expect.stringContaining("filtro 'evil'"),
        expect.stringContaining("'row.*'"),
      ]),
    );
  });

  it('bounds the number of blocks and the text length', () => {
    const many = { ...valid(), blocks: Array.from({ length: 201 }, () => ({ type: 'spacer', height: 10 })) };
    expect(errorsOf(many).join(' ')).toContain('máximo 200');
    const long = { ...valid(), blocks: [{ type: 'paragraph', text: 'x'.repeat(5001) }] };
    expect(errorsOf(long).join(' ')).toContain('supera 5000');
  });

  it('rejects table sources outside the request fields and duplicated slot keys', () => {
    const body = valid() as any;
    body.blocks[3].source = 'store.secrets';
    body.signature_slots.push({ key: 'empleado', role_label: 'Otro' });
    const errors = errorsOf(body).join(' ');
    expect(errors).toContain('fields.<campo>');
    expect(errors).toContain('repetida');
  });

  it('extracts the token schema: required unless defaulted, table source and logo included', () => {
    expect(tokenSchemaOfBlocks(validateBlocksBody(valid()))).toEqual([
      { path: 'fields.cedula', required: false },
      { path: 'fields.items', required: true },
      { path: 'fields.nombre', required: true },
      { path: 'fields.salario', required: true },
      { path: 'store.logo', required: false },
      { path: 'store.name', required: true },
    ]);
  });

  describe('base_pdf', () => {
    const base = () => ({
      fields: [{ page: 1, x: 10, y: 20, width: 100, height: 14, value: '{{ fields.nit }}' }],
      signature_slots: [{ key: 'firma', role_label: 'Representante', page: 1, x: 10, y: 100, width: 160, height: 50 }],
    });

    it('accepts fields and slots in points on the base pages', () => {
      expect(validateBasePdfBody(base(), 1).fields).toHaveLength(1);
      expect(tokenSchemaOfBasePdf(validateBasePdfBody(base(), 1))).toEqual([{ path: 'fields.nit', required: true }]);
    });

    it('rejects a page the base PDF does not have and negative coordinates', () => {
      const body = base() as any;
      body.fields[0].page = 3;
      body.fields[0].x = -1;
      let errors: string[] = [];
      try {
        validateBasePdfBody(body, 2);
      } catch (e) {
        errors = (e as TemplateBodyError).errors;
      }
      expect(errors.join(' ')).toContain('La página 3 no existe: el PDF base tiene 2');
      expect(errors.join(' ')).toContain('(x)');
    });
  });

  describe('bodyHash', () => {
    it('is stable across key order and changes with the content or the base file', () => {
      const a = bodyHash('blocks', { x: 1, y: [1, 2] }, null);
      expect(bodyHash('blocks', { y: [1, 2], x: 1 }, null)).toBe(a);
      expect(bodyHash('blocks', { x: 2, y: [1, 2] }, null)).not.toBe(a);
      expect(bodyHash('base_pdf', { x: 1, y: [1, 2] }, 'abc')).not.toBe(a);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
