import { createHelpTools } from '../tools/domains/help.tools';
import { createMemoryTools } from '../tools/domains/memory.tools';
import {
  LEARNING_FORMATS,
  LEARNING_FORMAT_KEY,
  LEARNING_FORMAT_VALUES_TEXT,
  normalizeLearningFormat,
} from './learning-format';

/** Every tool text (description or parameter description) that cites the key. */
function textsCitingTheKey(): { names: string[]; texts: string[] } {
  const tools = [
    ...createHelpTools({ knowledge: {} as never }),
    ...createMemoryTools({ memoryService: {} as never }),
  ];
  const texts: string[] = [];
  for (const tool of tools) {
    texts.push(tool.description);
    const properties = (tool.parameters.properties ?? {}) as Record<
      string,
      { description?: string }
    >;
    for (const property of Object.values(properties)) {
      texts.push(property.description ?? '');
    }
  }
  return {
    names: tools.map((tool) => tool.name),
    texts: texts.filter((text) => text.includes(LEARNING_FORMAT_KEY)),
  };
}

describe('learning.format vocabulary', () => {
  it('stores exactly two values: video and post', () => {
    expect([...LEARNING_FORMATS]).toEqual(['video', 'post']);
  });

  it.each([
    ['video', 'video'],
    [' Video ', 'video'],
    ['videos', 'video'],
    ['post', 'post'],
    ['paso a paso', 'post'],
    ['Paso a paso.', 'post'],
    ['paso-a-paso', 'post'],
    ['artículo', 'post'],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeLearningFormat(input)).toBe(expected);
  });

  it.each(['audio', '', 'video o post', 'prefiero leer'])(
    'does not guess a format for %p',
    (input) => {
      expect(normalizeLearningFormat(input)).toBeNull();
    },
  );

  it('help tools and memory tools describe the same pair of values', () => {
    const { names, texts } = textsCitingTheKey();
    const allowed = new Set<string>([
      LEARNING_FORMAT_KEY,
      ...names,
      ...LEARNING_FORMATS,
    ]);
    // search_help, get_help_article, remember and its content parameter
    const statingValues = texts.filter((text) =>
      /\bvideo\b|\bpost\b|paso a paso/i.test(text),
    );
    expect(statingValues.length).toBeGreaterThanOrEqual(4);
    for (const text of statingValues) {
      expect(text).toContain(LEARNING_FORMAT_VALUES_TEXT);
    }
    for (const text of texts) {
      // a quoted value other than video/post would be a second vocabulary
      const quoted = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      expect(quoted.filter((token) => !allowed.has(token))).toEqual([]);
    }
  });
});
