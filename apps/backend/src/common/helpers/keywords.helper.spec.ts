import {
  stripAccents,
  tokenizeQuery,
  normalizeKeywords,
  calculateRelevance,
} from './keywords.helper';

describe('keywords.helper', () => {
  describe('stripAccents', () => {
    it('elimina tildes y diacríticos manteniendo los caracteres base', () => {
      expect(stripAccents('camión')).toBe('camion');
      expect(stripAccents('FACTURACIÓN ELECTRÓNICA')).toBe('FACTURACION ELECTRONICA');
      expect(stripAccents('guía rápida')).toBe('guia rapida');
    });
  });

  describe('tokenizeQuery', () => {
    it('retorna array vacío si el input está vacío o son solo espacios', () => {
      expect(tokenizeQuery('')).toEqual([]);
      expect(tokenizeQuery('   ')).toEqual([]);
    });

    it('incluye tanto el término con tilde original como su variante sin tilde', () => {
      const tokens = tokenizeQuery('camión');
      expect(tokens).toContain('camión');
      expect(tokens).toContain('camion');
    });

    it('filtra stopwords en español', () => {
      const tokens = tokenizeQuery('el camión de la empresa');
      expect(tokens).toContain('camión');
      expect(tokens).toContain('camion');
      expect(tokens).toContain('empresa');
      expect(tokens).not.toContain('el');
      expect(tokens).not.toContain('de');
      expect(tokens).not.toContain('la');
    });

    it('ignora palabras de menos de 2 caracteres', () => {
      const tokens = tokenizeQuery('a b camión x');
      expect(tokens).toEqual(['camión', 'camion']);
    });
  });

  describe('normalizeKeywords', () => {
    it('retorna array vacío para valores nulos o indefinidos', () => {
      expect(normalizeKeywords(null)).toEqual([]);
      expect(normalizeKeywords(undefined)).toEqual([]);
      expect(normalizeKeywords('')).toEqual([]);
    });

    it('normaliza frases y términos individuales preservando tildes y sin tildes', () => {
      const result = normalizeKeywords(['Facturación Electrónica']);
      expect(result).toContain('facturación electrónica');
      expect(result).toContain('facturacion electronica');
      expect(result).toContain('facturación');
      expect(result).toContain('facturacion');
      expect(result).toContain('electrónica');
      expect(result).toContain('electronica');
    });

    it('soporta entrada como string delimitado por comas', () => {
      const result = normalizeKeywords('anular factura, POS');
      expect(result).toContain('anular factura');
      expect(result).toContain('anular');
      expect(result).toContain('factura');
      expect(result).toContain('pos');
    });
  });

  describe('calculateRelevance', () => {
    const item = {
      title: 'Cómo emitir una factura electrónica',
      summary: 'Guía paso a paso para facturación',
      keywords: ['facturacion', 'dian', 'electronica'],
      tags: ['ventas', 'facturacion'],
      content: 'Contenido detallado de facturación',
    };

    it('pondera con mayor puntuación cuando coincide en keywords y título', () => {
      const scoreWithKeywords = calculateRelevance(item, ['facturacion', 'electronica']);
      const scoreGeneric = calculateRelevance(item, ['ventas']);

      expect(scoreWithKeywords).toBeGreaterThan(scoreGeneric);
    });

    it('retorna 0 si no hay tokens', () => {
      expect(calculateRelevance(item, [])).toBe(0);
    });

    it('maneja coincidencias insensibles a tildes', () => {
      const scoreWithAccents = calculateRelevance(item, ['facturación']);
      const scoreWithoutAccents = calculateRelevance(item, ['facturacion']);

      expect(scoreWithAccents).toBe(scoreWithoutAccents);
      expect(scoreWithAccents).toBeGreaterThan(0);
    });
  });
});
