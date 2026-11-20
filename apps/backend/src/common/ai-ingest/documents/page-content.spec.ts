import { classifyPageText, pageContentParts, pagesMessageContent } from './page-content';

describe('page-content (native text first)', () => {
  const digital =
    'Factura 001 Cliente Acme SAS NIT 900123456 Calle 10 # 20-30 Cali total 1.250.000 '.repeat(4);

  it('classifies PDF page text', () => {
    expect(classifyPageText(digital)).toBe('text');
    expect(classifyPageText('')).toBe('image');
    expect(classifyPageText('  3 / 10  ')).toBe('image');
    expect(classifyPageText('Lista de socios gimnasio enero')).toBe('text+image');
    // Enough characters but mostly symbols (broken font encoding) → also the image.
    expect(classifyPageText('§¶•ªº¬'.repeat(60))).toBe('text+image');
  });

  it('a text page is sent as text only; never a raw PDF', () => {
    const parts = pageContentParts({ page_number: 2, mode: 'text', text: digital });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(parts[0].text).toContain('Page 2');
    expect(JSON.stringify(parts)).not.toContain('application/pdf');
  });

  it('scanned pages and photo strips carry their image', () => {
    const image = 'data:image/jpeg;base64,AAAA';
    const scanned = pageContentParts({ page_number: 1, mode: 'image', text: '', image });
    expect(scanned.map((p) => p.type)).toEqual(['text', 'image_url']);
    expect(scanned[1].image_url).toEqual({ url: image, detail: 'high' });

    const mixed = pageContentParts({ page_number: 1, mode: 'text+image', text: 'Lista', image });
    expect(mixed.map((p) => p.type)).toEqual(['text', 'image_url']);
    expect(mixed[0].text).toContain('Lista');

    const strip = pageContentParts({
      page_number: 2,
      mode: 'image',
      text: '',
      image,
      strip: { index: 2, count: 3 },
    });
    expect(strip[0].text).toContain('part 2 of 3');
  });

  it('a batch message starts with the instruction', () => {
    const content = pagesMessageContent('Extract members', [
      { page_number: 1, mode: 'text', text: digital },
    ]);
    expect(content[0]).toEqual({ type: 'text', text: 'Extract members' });
    expect(content).toHaveLength(2);
  });
});
