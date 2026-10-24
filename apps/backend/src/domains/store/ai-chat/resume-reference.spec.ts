import { isVagueBackReference, resumeReferenceBlock } from './resume-reference';

const history = (...asked: string[]) =>
  asked.flatMap((content) => [
    { role: 'user', content },
    { role: 'assistant', content: 'respuesta' },
  ]);

describe('a vague back-reference resumes the only plausible thread', () => {
  it.each([
    'sigue con lo de ayer',
    'continúa',
    'retoma lo de antes',
    'sigamos donde íbamos',
  ])('"%s" is a vague back-reference', (message) => {
    expect(isVagueBackReference(message)).toBe(true);
  });

  it.each([
    'sigue vendiendo el combo de hamburguesa en la carta',
    '¿Cómo me fue con los cierres de caja la semana pasada?',
    'continúa la orden 45 con el proveedor Alpina',
  ])('"%s" names its own topic and is left alone', (message) => {
    expect(isVagueBackReference(message)).toBe(false);
  });

  it('puts the previous request in front of the model with the resume rule', () => {
    const goal = 'sigue con lo de ayer';
    const block = resumeReferenceBlock(
      [
        ...history('¿Cómo me fue con los cierres de caja la semana pasada?'),
        { role: 'user', content: goal },
      ],
      goal,
    );

    expect(block).toContain(
      '«¿Cómo me fue con los cierres de caja la semana pasada?»',
    );
    expect(block).toContain('retómalo sin preguntar');
    expect(block).not.toContain(`«${goal}»;`);
  });

  it('lists the most recent topics first and skips earlier vague turns', () => {
    const block = resumeReferenceBlock(
      history('ventas de ayer', 'continúa', 'stock bajo de bebidas'),
      'retoma eso',
    );

    expect(block).toContain('«stock bajo de bebidas»; «ventas de ayer»');
    expect(block).not.toContain('«continúa»');
  });

  it('adds nothing for a concrete request or an empty thread', () => {
    expect(
      resumeReferenceBlock(history('ventas de ayer'), 'muéstrame los gastos'),
    ).toBeNull();
    expect(resumeReferenceBlock([], 'sigue con lo de ayer')).toBeNull();
  });
});
