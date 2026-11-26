import { SpeechMarkdownFilter } from './vexi-speech.markdown';

/**
 * B2 (PR #1430): a chunk that ends exactly on the closing fence must not have
 * those backticks mistaken for a fence that is starting. Doing so released the
 * block without its closing fence, the code pattern never matched and the code
 * was dictated as prose.
 */
describe('SpeechMarkdownFilter — fenced code', () => {
  function filtered(chunks: string[]): string {
    const filter = new SpeechMarkdownFilter();
    return chunks.map((chunk) => filter.push(chunk)).join('') + filter.flush();
  }

  const BLOCK = '```json\n{"precio": 3500, "sku": "ABC"}\n```';

  it('«Escuchar»: a message that ends in a code block (one push + flush) never dictates it', () => {
    const spoken = filtered([`Aquí va el ejemplo.\n${BLOCK}`]);

    expect(spoken).not.toMatch(/precio|3500|sku|ABC|json|[{}"`]/);
    expect(spoken).toContain('Aquí va el ejemplo.');
  });

  it('stream: a chunk that ends on the closing fence, then prose, never dictates the block', () => {
    const spoken = filtered([
      `Aquí va el ejemplo.\n${BLOCK}`,
      '\n\nListo, eso es todo.',
    ]);

    expect(spoken).not.toMatch(/precio|3500|sku|ABC|json|[{}"`]/);
    expect(spoken).toContain('Aquí va el ejemplo.');
    expect(spoken).toContain('Listo, eso es todo.');
  });

  it('code at the very start of the text is never dictated', () => {
    expect(filtered([BLOCK])).not.toMatch(/precio|3500|sku|ABC|json|[{}"`]/);

    const spoken = filtered([BLOCK, '\nEse es el formato.']);
    expect(spoken).not.toMatch(/precio|3500|sku|ABC|json|[{}"`]/);
    expect(spoken).toContain('Ese es el formato.');
  });

  it('trailing backticks that open a new fence are still held back', () => {
    const spoken = filtered([
      'Primero esto.\n',
      '``',
      '`json\n{"sku": "ABC"}\n```\nY después esto.',
    ]);

    expect(spoken).not.toMatch(/sku|ABC|json|[{}"`]/);
    expect(spoken).toContain('Primero esto.');
    expect(spoken).toContain('Y después esto.');
  });
});
