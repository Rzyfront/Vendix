import {
  formatJsonError,
  parseTemplateJsonText,
  readImportServerError,
  summarizeTemplateJson,
  templateJsonFilename,
} from './template-json-import.util';
import { buildExampleTemplateJson, validateTemplateJson } from './template-json.contract';

describe('template-json-import.util', () => {
  describe('parseTemplateJsonText', () => {
    it('asks for content when the text is empty', () => {
      const r = parseTemplateJsonText('   ');
      expect(r.ok).toBeFalse();
    });

    it('parses valid JSON and strips a BOM', () => {
      const r = parseTemplateJsonText('﻿{"a":1}');
      expect(r.ok).toBeTrue();
      if (r.ok) expect(r.value).toEqual({ a: 1 });
    });

    it('reports a friendly syntax error in Spanish', () => {
      const r = parseTemplateJsonText('{"a": 1,\n  "b": }');
      expect(r.ok).toBeFalse();
      if (!r.ok) {
        expect(r.message).toContain('El JSON no es válido');
        expect(r.message).not.toContain('Unexpected');
      }
    });
  });

  it('templateJsonFilename builds an ascii slug', () => {
    expect(templateJsonFilename('Mi plantilla ÚNICA #1')).toBe('mi-plantilla-unica-1.json');
    expect(templateJsonFilename('')).toBe('plantilla.json');
    expect(templateJsonFilename(null)).toBe('plantilla.json');
  });

  it('formatJsonError prefixes the path when present', () => {
    expect(formatJsonError({ path: 'sections[0].title', message: 'Falta' })).toBe('sections[0].title: Falta');
    expect(formatJsonError({ path: '', message: 'Falta' })).toBe('Falta');
  });

  it('summarizeTemplateJson describes the example template', () => {
    const v = validateTemplateJson(buildExampleTemplateJson());
    expect(v.ok).toBeTrue();
    if (!v.ok) return;
    const summary = summarizeTemplateJson(v.value);
    expect(summary.name).toBe(v.value.name);
    expect(summary.steps.length).toBeGreaterThan(0);
    expect(summary.total_fields).toBeGreaterThan(0);
    const docs = summary.steps.flatMap((s) => s.sections).flatMap((s) => s.fields).find((f) => f.type === 'file');
    expect(docs?.documents).toBeDefined();
  });

  describe('readImportServerError', () => {
    it('reads details.errors from an HttpErrorResponse-like object', () => {
      const r = readImportServerError({
        error: {
          error_code: 'DCOL_IMPORT_001',
          message: 'La plantilla tiene errores',
          details: { errors: [{ path: 'sections[0].items[2].field.type', message: 'Tipo no válido' }] },
        },
      });
      expect(r.message).toBe('La plantilla tiene errores');
      expect(r.errors).toEqual([{ path: 'sections[0].items[2].field.type', message: 'Tipo no válido' }]);
    });

    it('falls back to a generic message without details', () => {
      const r = readImportServerError({ status: 0 });
      expect(r.errors).toEqual([]);
      expect(r.message).toContain('No se pudo importar');
    });

    it('joins array messages', () => {
      const r = readImportServerError({ error: { message: ['a', 'b'] } });
      expect(r.message).toBe('a b');
    });
  });
});
