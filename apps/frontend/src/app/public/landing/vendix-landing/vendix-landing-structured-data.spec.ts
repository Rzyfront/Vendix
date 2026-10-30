import { buildVendixStructuredData } from './vendix-landing-structured-data';

type Node = Record<string, any>;
const graph = (prices?: number[]): Node[] =>
  (buildVendixStructuredData(prices) as any)['@graph'];
const byType = (nodes: Node[], type: string): Node =>
  nodes.find((n) => n['@type'] === type)!;

describe('buildVendixStructuredData', () => {
  it('publica Organization con razón social, contacto y perfiles', () => {
    const org = byType(graph(), 'Organization');
    expect(org['@id']).toBe('https://vendix.online/#organization');
    expect(org['legalName']).toContain('QUICKSS');
    expect(org['contactPoint'][0]['email']).toBe('soporte@vendix.online');
    expect(org['sameAs'].length).toBeGreaterThan(0);
  });

  it('identifica a Vendix como software colombiano y enlaza su Perfil de Negocio', () => {
    const org = byType(graph(), 'Organization');
    expect(org['sameAs']).toContain('https://maps.google.com/?cid=2119636985592340036');
    expect(org['description']).toContain('Software colombiano');
    expect(org['address']['addressLocality']).toBe('Riohacha');
    expect(org['address']['addressCountry']).toBe('CO');
    expect(org['address']['streetAddress']).toBeUndefined();
    expect(org['areaServed']).toBe('CO');
  });

  it('usa AggregateOffer con el rango de los planes mensuales', () => {
    const offers = byType(graph([69900, 49900, 190000, 89900]), 'SoftwareApplication')['offers'];
    expect(offers['@type']).toBe('AggregateOffer');
    expect(offers['lowPrice']).toBe('49900');
    expect(offers['highPrice']).toBe('190000');
    expect(offers['offerCount']).toBe(4);
    expect(offers['priceCurrency']).toBe('COP');
  });

  it('usa Offer simple con un solo precio', () => {
    const offers = byType(graph([49900]), 'SoftwareApplication')['offers'];
    expect(offers['@type']).toBe('Offer');
    expect(offers['price']).toBe('49900');
  });

  it('omite offers sin precios válidos', () => {
    expect(byType(graph([]), 'SoftwareApplication')['offers']).toBeUndefined();
    expect(byType(graph([0, NaN, -1]), 'SoftwareApplication')['offers']).toBeUndefined();
  });

  it('nunca publica calificaciones ni reseñas', () => {
    const json = JSON.stringify(buildVendixStructuredData([49900, 89900]));
    expect(json).not.toContain('aggregateRating');
    expect(json).not.toContain('"review"');
  });
});
