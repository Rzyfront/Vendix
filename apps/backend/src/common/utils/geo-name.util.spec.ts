import {
  geoNameInList,
  normalizeGeoName,
  postalCodeInList,
} from './geo-name.util';

describe('geo-name.util', () => {
  describe('normalizeGeoName', () => {
    it('quita tildes, mayúsculas y espacios', () => {
      expect(normalizeGeoName('  Riohacha ')).toBe('riohacha');
    });

    it('quita artículos iniciales (zona "Guajira" vs dirección "La Guajira")', () => {
      expect(normalizeGeoName('La Guajira')).toBe('guajira');
      expect(normalizeGeoName('El Rosario')).toBe('rosario');
      expect(normalizeGeoName('Departamento de La Guajira')).toBe('guajira');
    });

    it('no rompe nombres sin artículo ni palabras que empiezan parecido', () => {
      expect(normalizeGeoName('Delicias')).toBe('delicias');
      expect(normalizeGeoName('La')).toBe('la');
    });
  });

  describe('geoNameInList', () => {
    it('matchea región con y sin artículo', () => {
      expect(geoNameInList('La Guajira', ['Guajira'])).toBe(true);
      expect(geoNameInList('La Guajira', ['La Guajira'])).toBe(true);
      expect(geoNameInList('Riohacha', ['Riohacha'])).toBe(true);
    });

    it('no matchea regiones distintas', () => {
      expect(geoNameInList('La Guajira', ['Cesar'])).toBe(false);
    });
  });

  describe('postalCodeInList', () => {
    it('matchea exacto', () => {
      expect(postalCodeInList('440001', ['440001'])).toBe(true);
    });

    it('matchea prefijo en ambos sentidos (zona recortada o dirección recortada)', () => {
      expect(postalCodeInList('440001', ['44000'])).toBe(true);
      expect(postalCodeInList('44000', ['440001'])).toBe(true);
    });

    it('no matchea cuando solo coincide parcialmente sin ser prefijo', () => {
      // "44001" no es prefijo de "440001" (difieren en el 5.º dígito).
      expect(postalCodeInList('440001', ['44001'])).toBe(false);
    });

    it('no matchea por una sola cifra ni códigos distintos', () => {
      expect(postalCodeInList('440001', ['4'])).toBe(false);
      expect(postalCodeInList('440001', ['110111'])).toBe(false);
      expect(postalCodeInList('', ['440001'])).toBe(false);
    });
  });
});
