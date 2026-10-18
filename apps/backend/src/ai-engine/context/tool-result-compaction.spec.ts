import {
  ARTIFACT_PAGE_JSON_CHARS,
  compactRecoverableToolResult,
  describeToolResult,
  isBoundedArtifactPage,
  readArtifactPage,
} from './tool-result-compaction';

describe('recoverable tool-result compaction', () => {
  it('does not compact before full persistence succeeds and uses structural summaries, not JSON prefixes', async () => {
    const raw = JSON.stringify({
      data: Array.from({ length: 400 }, (_, id) => ({
        id,
        amount: id + 1,
        note: 'café'.repeat(10),
      })),
      currency: 'COP',
    });
    let saved: string | undefined;
    const output = await compactRecoverableToolResult('read_sales', raw, {
      requested_fields: ['id', 'amount'],
      evidence_refs: ['tool_call:c1'],
      persist: async () => {
        saved = raw;
        return {
          artifact_ref: {
            objective_id: 'goal',
            result_id: 'r1',
            path: '/store/vexi/objectives/goal/results/r1',
          },
        };
      },
    });
    expect(saved).toBe(raw);
    expect(output.length).toBeLessThan(6000);
    const compacted = JSON.parse(output);
    expect(compacted).toMatchObject({
      compaction_version: '1',
      rows: 400,
      total: 400,
      complete: false,
      has_more: true,
      truncated: true,
      requested_fields: ['id', 'amount'],
      units: { currency: 'COP' },
      evidence_refs: ['tool_call:c1'],
    });
    expect(compacted.summary).not.toContain(raw.slice(0, 20));
    expect(compacted.ids).toContainEqual({ field: 'id', value: 0 });
    expect(compacted.ids_complete).toBe(false);
  });

  it('retains full data when persistence fails or is unavailable', async () => {
    const raw = 'confidential dataset '.repeat(500);
    expect(
      await compactRecoverableToolResult('read', raw, {
        persist: async () => null,
      }),
    ).toBe(raw);
    expect(
      await compactRecoverableToolResult('read', raw, {
        persist: async () => {
          throw new Error('storage unavailable');
        },
      }),
    ).toBe(raw);
  });

  it('never persists small, already compacted or historical bounded reader responses recursively', async () => {
    const persist = jest.fn(async () => ({ block_id: 'b1' }));
    for (const raw of [
      'small',
      JSON.stringify({ compaction_version: '1', summary: 'x'.repeat(9000) }),
      JSON.stringify({
        data: {
          artifact: true,
          bounded: true,
          reusable_for_write: false,
          text: 'x'.repeat(9000),
        },
      }),
    ])
      expect(await compactRecoverableToolResult('read', raw, { persist })).toBe(
        raw,
      );
    expect(persist).not.toHaveBeenCalled();
    expect(
      isBoundedArtifactPage({
        data: { artifact: true, bounded: true, reusable_for_write: false },
      }),
    ).toBe(true);
    expect(
      isBoundedArtifactPage({
        rows: [{ artifact: true, bounded: true, reusable_for_write: false }],
      }),
    ).toBe(false);
  });

  it('keeps source pagination distinct from the saved snapshot record count', () => {
    expect(
      describeToolResult(
        JSON.stringify({
          data: {
            rows: [{ id: 1 }, { id: 2 }],
            pagination: {
              total: 200,
              has_more: true,
              complete: false,
              next_cursor: 'upstream',
            },
          },
        }),
      ),
    ).toMatchObject({
      rows: 2,
      source_pagination: {
        total: 200,
        complete: false,
        has_more: true,
        cursor: 'upstream',
      },
    });
  });
});

describe('bounded artifact reader', () => {
  it.each(['plain', 'escaped', 'object'])(
    'round-trips >6000 chars %s with a cursor and exact end',
    (kind) => {
      const text =
        kind === 'escaped'
          ? '\0\n"\\'.repeat(3500) + 'fin ☕'
          : 'café ☕\n'.repeat(2000);
      const value = kind === 'object' ? { id: 1, long_text: text } : text;
      let cursor: string | undefined;
      let reconstructed = '';
      let pages = 0;
      while (true) {
        const page = readArtifactPage(value, { cursor });
        expect(JSON.stringify(page).length).toBeLessThanOrEqual(
          ARTIFACT_PAGE_JSON_CHARS,
        );
        expect(page).toMatchObject({
          format: 'text',
          artifact: true,
          bounded: true,
          reusable_for_write: false,
          units: { pagination: 'utf16_code_units' },
        });
        expect(page.offset).toBe(reconstructed.length);
        reconstructed += page.text;
        if (!page.has_more) {
          expect(page.cursor).toBeNull();
          break;
        }
        expect(page.next_offset).toBe(reconstructed.length);
        cursor = page.cursor!;
        expect(++pages).toBeLessThan(200);
      }
      expect(pages).toBeGreaterThan(1);
      expect(reconstructed).toBe(
        typeof value === 'string' ? value : JSON.stringify(value),
      );
      const end = readArtifactPage(value, {
        text_offset: reconstructed.length + 100,
      });
      expect(end).toMatchObject({
        text: '',
        has_more: false,
        cursor: null,
        complete: false,
      });
    },
  );

  it('pages whole rows, reconstructs a complete sum and does not mark the last partial page complete', () => {
    const rows = Array.from({ length: 311 }, (_, id) => ({
      id,
      amount: id + 1,
      note: '\0'.repeat(20),
    }));
    const original = { data: { items: rows }, currency: 'COP' };
    const collected: unknown[] = [];
    let cursor: string | undefined;
    while (true) {
      const page = readArtifactPage(original, { cursor, limit: 500 });
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(
        ARTIFACT_PAGE_JSON_CHARS,
      );
      collected.push(...(page.data as typeof original).data.items);
      expect(page.total).toBe(rows.length);
      expect(page.complete).toBe(false);
      if (!page.has_more) break;
      cursor = page.cursor!;
    }
    expect(collected).toEqual(rows);
    const aggregate = readArtifactPage(original, {
      aggregate: { field: 'amount', function: 'sum' },
    });
    expect(aggregate).toMatchObject({
      format: 'aggregate',
      complete: true,
      matched_records: 311,
      data: { value: (311 * 312) / 2 },
    });
  });

  it('supports direct-column projection without prototype traversal, and fences changed snapshot/query cursors', () => {
    const value = [
      { id: 1, amount: 2, secret: 'not selected' },
      { id: 2, amount: 3 },
    ];
    const page = readArtifactPage(value, {
      limit: 1,
      columns: ['id', 'amount'],
    });
    expect(page.data).toEqual([{ id: 1, amount: 2 }]);
    expect(
      readArtifactPage(value, {
        cursor: page.cursor!,
        columns: ['id', 'amount'],
      }).data,
    ).toEqual([{ id: 2, amount: 3 }]);
    expect(() =>
      readArtifactPage(value, { cursor: page.cursor!, columns: ['id'] }),
    ).toThrow('changed snapshot/query');
    expect(() =>
      readArtifactPage([...value, {}], {
        cursor: page.cursor!,
        columns: ['id', 'amount'],
      }),
    ).toThrow('changed snapshot/query');
    for (const column of [
      '__proto__',
      'constructor',
      'nested.path',
      'amount;drop',
    ])
      expect(() => readArtifactPage(value, { columns: [column] })).toThrow(
        'columns',
      );
  });

  it('falls back to labeled JSON text for a giant single row and recovers every byte without new persistence', () => {
    const value = { rows: [{ id: 1, note: '\0'.repeat(12000) }] };
    let page = readArtifactPage(value);
    let text = '';
    do {
      expect(page.format).toBe('text');
      expect(page.encoding).toBe('json');
      text += page.text;
      if (!page.cursor) break;
      page = readArtifactPage(value, { cursor: page.cursor });
    } while (true);
    expect(JSON.parse(text)).toEqual(value);
  });

  it('counts actual escaped outer JSON including metadata and stays idempotent for repeated cursors', () => {
    const value = '\0'.repeat(9000);
    const options = {
      envelope: (page: unknown) => ({ receipt: 'x'.repeat(800), data: page }),
    };
    const first = readArtifactPage(value, options);
    expect(JSON.stringify(options.envelope(first)).length).toBeLessThanOrEqual(
      ARTIFACT_PAGE_JSON_CHARS,
    );
    expect(first.text!.length).toBeLessThan(3000);
    expect(
      readArtifactPage(value, { ...options, cursor: first.cursor! }),
    ).toEqual(readArtifactPage(value, { ...options, cursor: first.cursor! }));
    expect(() =>
      readArtifactPage(value, {
        envelope: () => ({ impossible: 'x'.repeat(9000) }),
      }),
    ).toThrow('metadata exceeds');
  });

  it('rejects malformed/tampered cursors and executable aggregate paths, never evaluates business strings', () => {
    for (const cursor of ['not-base64!', 'e30', 'a'.repeat(500)])
      expect(() => readArtifactPage([], { cursor })).toThrow('cursor');
    for (const field of ['__proto__', 'nested.amount', 'process.exit()'])
      expect(() =>
        readArtifactPage([], { aggregate: { field, function: 'sum' } }),
      ).toThrow('aggregate');
    expect(() =>
      readArtifactPage([{ amount: 2 }, { amount: '100' }, {}, { amount: 3 }], {
        aggregate: { field: 'amount', function: 'sum' },
      }),
    ).toThrow('finite numeric values in every row');
    expect(
      readArtifactPage([{ amount: 2 }, { amount: '100' }, {}], {
        aggregate: { field: 'amount', function: 'count' },
      }).data,
    ).toEqual({ value: 3, numeric_records: 1 });
  });
});
