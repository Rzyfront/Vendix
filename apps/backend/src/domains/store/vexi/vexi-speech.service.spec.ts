import {
  VexiSpeechSegmenter,
  firstSentenceEnd,
  lastClauseEnd,
  hasWordCharacter,
} from './vexi-speech.segmenter';
import {
  localizeNumbersForSpeech,
  stripMarkdownForSpeech,
  VexiSpeechService,
} from './vexi-speech.service';
import { VexiSpeechCache } from './vexi-speech.cache';
import { SEGMENT_TARGETS, VOICE_FILLERS } from './vexi-speech.constants';

describe('firstSentenceEnd', () => {
  it('requires whitespace or end-of-string after the terminator', () => {
    // The whole reason the guard exists: a business assistant emits amounts
    // constantly, and without it every decimal reads as two numbers.
    expect(firstSentenceEnd('El total es 3.14 y ya')).toBeNull();
    expect(firstSentenceEnd('Vendiste 1.500 unidades hoy')).toBeNull();
  });

  it('finds a real sentence end', () => {
    expect(firstSentenceEnd('Hola. Chau')).toBe(5);
    expect(firstSentenceEnd('¿Cuántas ventas? Muchas')).toBe(16);
    expect(firstSentenceEnd('Listo!')).toBe(6);
  });

  it('closes the sentence after an amount when a real period follows', () => {
    // The decimal is skipped, the terminator after "unidades" is taken.
    expect(firstSentenceEnd('Vendiste 1.500 unidades. Nada más')).toBe(24);
  });

  it('does not treat a common abbreviation as a sentence end', () => {
    expect(firstSentenceEnd('Habló el Sr. Pérez ayer.')).toBe(24);
    expect(firstSentenceEnd('Ver ref. 1234 arriba.')).toBe(21);
  });

  it('does not treat a single-letter initial as a sentence end', () => {
    expect(firstSentenceEnd('Vino J. Pérez hoy.')).toBe(18);
  });

  it('treats an ellipsis as a real pause, not an abbreviation', () => {
    // A run of dots is never an abbreviation, so the check must only apply to a
    // lone period. The index lands past the whole run, not past the first dot.
    expect(firstSentenceEnd('A ver... dejame')).toBe(8);
  });
});

describe('lastClauseEnd', () => {
  it('returns the index past the last clause boundary', () => {
    expect(lastClauseEnd('uno, dos, tres')).toBe(9);
    expect(lastClauseEnd('sin comas aquí')).toBeNull();
  });

  it('ignores a colon glued to the next character', () => {
    // Same whitespace guard: "12:30" is a time, not a clause boundary.
    expect(lastClauseEnd('a las 12:30')).toBeNull();
  });
});

describe('VexiSpeechSegmenter', () => {
  it('emits the first sentence as soon as it closes', () => {
    const segmenter = new VexiSpeechSegmenter();

    const segments = segmenter.push('Tenés 47 ventas hoy. ');

    expect(segments).toEqual(['Tenés 47 ventas hoy.']);
    // The point of the first target: sound starts on a short cut, not on a
    // paragraph.
    expect(segments[0].length).toBeLessThanOrEqual(
      SEGMENT_TARGETS[0] * 1.4,
    );
  });

  it('holds text back mid-stream until a boundary is worth taking', () => {
    const segmenter = new VexiSpeechSegmenter();

    // Under the first target with nothing closed: waiting is correct.
    expect(segmenter.push('Tenés 47')).toEqual([]);
    expect(segmenter.pending()).toBe('Tenés 47');
  });

  it('emits the remainder on flush even without closing punctuation', () => {
    const segmenter = new VexiSpeechSegmenter();
    segmenter.push('y ya está');

    expect(segmenter.flush()).toEqual(['y ya está']);
    expect(segmenter.pending()).toBe('');
  });

  it('grows the budget so later segments sound like sentences', () => {
    const segmenter = new VexiSpeechSegmenter();

    // No sentence terminators at all, so every cut is a budgeted one and the
    // growth is visible directly.
    const segments = segmenter.push('palabra, '.repeat(200));

    expect(segments.length).toBeGreaterThanOrEqual(4);
    const lengths = segments.slice(0, 4).map((s) => s.length);

    expect(lengths[0]).toBeLessThanOrEqual(SEGMENT_TARGETS[0]);
    expect(lengths[1]).toBeLessThanOrEqual(SEGMENT_TARGETS[1]);
    expect(lengths[2]).toBeLessThanOrEqual(SEGMENT_TARGETS[2]);
    expect(lengths[3]).toBeLessThanOrEqual(SEGMENT_TARGETS[3]);

    // Strictly increasing is the property that matters: the first is cheap to
    // start, the rest are long enough not to sound clipped.
    expect(lengths[1]).toBeGreaterThan(lengths[0]);
    expect(lengths[2]).toBeGreaterThan(lengths[1]);
    expect(lengths[3]).toBeGreaterThan(lengths[2]);
  });

  it('cuts a runaway sentence instead of waiting for a period', () => {
    const segmenter = new VexiSpeechSegmenter();

    // ~500 characters with commas and no terminator. Waiting for the period
    // would hold the audio hostage for the whole answer.
    const source = 'primero mucho texto, segundo mucho texto, '.repeat(12);
    const segments = [...segmenter.push(source), ...segmenter.flush()];

    expect(segments.length).toBeGreaterThan(1);
    // Sound starts on a fraction of the answer, not on all of it.
    expect(segments[0].length).toBeLessThanOrEqual(SEGMENT_TARGETS[0]);

    // The invariant that matters is that no cut lands inside a word: rejoining
    // reproduces the source exactly. A mid-word cut would turn "texto" into
    // "text" + "o" and the join would read "text o".
    expect(segments.join(' ').replace(/\s+/g, ' ').trim()).toBe(
      source.replace(/\s+/g, ' ').trim(),
    );
  });

  it('never splits an amount across segments', () => {
    const segmenter = new VexiSpeechSegmenter();

    const segments = [
      ...segmenter.push(
        'relleno de texto para pasar el presupuesto inicial y forzar un corte ' +
          'presupuestado antes de llegar al monto 1.500 pesos exactos',
      ),
      ...segmenter.flush(),
    ];

    const joined = segments.join(' ');
    expect(joined).toContain('1.500');
    // A cut inside the decimal would leave a segment ending in "1." and the
    // next starting with "500", which the synthesizer reads as two numbers.
    expect(segments.some((s) => /\d\.$/.test(s))).toBe(false);
    expect(segments.some((s) => /^\d{3}\b/.test(s))).toBe(false);
  });

  it('consumes punctuation-only text instead of speaking it', () => {
    const segmenter = new VexiSpeechSegmenter();
    segmenter.push('— — —');

    // Handing "—" to a synthesizer either errors or emits a noise.
    expect(segmenter.flush()).toEqual([]);
  });

  it('keeps markers in the emitted text so captions stay formatted', () => {
    const segmenter = new VexiSpeechSegmenter();

    const segments = segmenter.push('El **total** es 1.500 pesos. ');

    // Stripping happens downstream, per segment, on the audio branch only.
    expect(segments[0]).toBe('El **total** es 1.500 pesos.');
  });
});

describe('hasWordCharacter', () => {
  it('accepts accented letters and digits, rejects punctuation', () => {
    expect(hasWordCharacter('ñ')).toBe(true);
    expect(hasWordCharacter('7')).toBe(true);
    expect(hasWordCharacter('¿—…!')).toBe(false);
  });
});

describe('stripMarkdownForSpeech', () => {
  it('removes emphasis markers without touching amounts', () => {
    expect(stripMarkdownForSpeech('El **total** es 1.500')).toBe(
      'El total es 1.500',
    );
  });

  it('keeps a link label and drops its target', () => {
    expect(
      stripMarkdownForSpeech('Mirá [el reporte](https://vendix.com/r/1) ahí'),
    ).toBe('Mirá el reporte ahí');
  });

  it('removes list markers but never a decimal', () => {
    expect(stripMarkdownForSpeech('- Coca\n- Pepsi')).toBe('Coca Pepsi');
    expect(stripMarkdownForSpeech('1. Primero\n2. Segundo')).toBe(
      'Primero Segundo',
    );
    // The trailing-space requirement is what separates the two cases.
    expect(stripMarkdownForSpeech('1.500 pesos')).toBe('1.500 pesos');
  });

  it('flattens a table into readable prose', () => {
    expect(
      stripMarkdownForSpeech('| Producto | Stock |\n|---|---|\n| Coca | 12 |'),
    ).toBe('Producto Stock Coca 12');
  });

  it('drops fenced code entirely', () => {
    expect(
      stripMarkdownForSpeech('Mirá esto:\n```sql\nSELECT 1;\n```\nlisto'),
    ).toBe('Mirá esto: listo');
  });

  it('removes heading and quote markers', () => {
    expect(stripMarkdownForSpeech('## Resumen\n> nota')).toBe('Resumen nota');
  });
});

describe('localizeNumbersForSpeech', () => {
  it('moves the currency word after the amount, the way it is spoken', () => {
    expect(localizeNumbersForSpeech('Vendiste $1.500.000 hoy', 'COP')).toBe(
      'Vendiste 1.500.000 pesos hoy',
    );
    expect(localizeNumbersForSpeech('El total es COP 45.000', 'COP')).toBe(
      'El total es 45.000 pesos',
    );
    expect(localizeNumbersForSpeech('Costó 45.000 COP', 'COP')).toBe(
      'Costó 45.000 pesos',
    );
  });

  it('speaks the currency of the store, not of the symbol', () => {
    // "$" is not a currency. The same character is pesos in Bogotá and dollars
    // in Miami, and only the store knows which.
    expect(localizeNumbersForSpeech('Son $20', 'USD')).toBe('Son 20 dólares');
    expect(localizeNumbersForSpeech('Son $20', 'PEN')).toBe('Son 20 soles');
  });

  it('spells an unmapped code instead of guessing pesos', () => {
    // Wrong but honest. Guessing a currency name is how a report ends up
    // claiming an amount in a unit it was never denominated in.
    expect(localizeNumbersForSpeech('Son XOF 500', 'XOF')).toBe('Son 500 XOF');
  });

  it('groups a long integer so it reads as a quantity', () => {
    // Ungrouped, a synthesizer reads this as a digit stream: "uno cinco cero
    // cero cero cero cero".
    expect(localizeNumbersForSpeech('Tenés 1500000 en caja', 'COP')).toBe(
      'Tenés 1.500.000 en caja',
    );
    expect(localizeNumbersForSpeech('Son 45000 unidades', 'COP')).toBe(
      'Son 45.000 unidades',
    );
  });

  it('leaves short numbers and already-grouped ones alone', () => {
    expect(localizeNumbersForSpeech('Quedan 47 ventas', 'COP')).toBe(
      'Quedan 47 ventas',
    );
    expect(localizeNumbersForSpeech('Son 999 unidades', 'COP')).toBe(
      'Son 999 unidades',
    );
    expect(localizeNumbersForSpeech('Ya son 1.500.000', 'COP')).toBe(
      'Ya son 1.500.000',
    );
  });

  it('never regroups something that carries a decimal', () => {
    // Grouping the integer part of "1500.50" would produce "1.500.50", which is
    // not a number in any locale — it is worse than leaving it untouched.
    expect(localizeNumbersForSpeech('El promedio es 1500.50', 'COP')).toBe(
      'El promedio es 1500.50',
    );
    expect(localizeNumbersForSpeech('El factor es 3.14', 'COP')).toBe(
      'El factor es 3.14',
    );
    expect(localizeNumbersForSpeech('Son 1500,75 unidades', 'COP')).toBe(
      'Son 1500,75 unidades',
    );
  });

  it('never touches an identifier that happens to contain digits', () => {
    // The guard that matters most in practice. Vexi names SKUs, NITs, order
    // numbers and phone numbers constantly, and none of them is a quantity.
    expect(localizeNumbersForSpeech('El SKU es QA-1234567', 'COP')).toBe(
      'El SKU es QA-1234567',
    );
    expect(localizeNumbersForSpeech('NIT 900123456-7', 'COP')).toBe(
      'NIT 900123456-7',
    );
    expect(localizeNumbersForSpeech('La orden ORD2024001 llegó', 'COP')).toBe(
      'La orden ORD2024001 llegó',
    );
  });

  it('says percent as a word', () => {
    expect(localizeNumbersForSpeech('Subió 12%', 'COP')).toBe(
      'Subió 12 por ciento',
    );
  });

  it('defaults to the CO currency when the store resolved none', () => {
    expect(localizeNumbersForSpeech('Son $500')).toBe('Son 500 pesos');
  });
});

describe('VexiSpeechCache', () => {
  let cache: VexiSpeechCache;
  const params = {
    model: 'gpt-4o-mini-tts',
    voice: 'shimmer',
    format: 'mp3',
    speed: 1,
    // Obligatorio desde que el volumen entro a la clave de cache: un params
    // sin vol produce una clave distinta a la que warmFillers pinneo.
    vol: 1,
  };
  const audio = { audioBase64: 'AAAA', contentType: 'audio/mpeg' };

  beforeEach(() => {
    cache = new VexiSpeechCache();
  });

  it('keys on everything that changes the audio', () => {
    const base = cache.key('Listo', params);

    expect(cache.key('Listo', params)).toBe(base);
    expect(cache.key('Listo', { ...params, voice: 'coral' })).not.toBe(base);
    expect(cache.key('Listo', { ...params, speed: 1.2 })).not.toBe(base);
    expect(cache.key('Hecho', params)).not.toBe(base);
  });

  it('serves a repeated phrase from cache', () => {
    const key = cache.key('Listo', params);
    cache.set(key, audio);

    expect(cache.get(key)).toEqual(audio);
  });

  it('evicts the least recently used entry past the count cap', () => {
    const first = cache.key('phrase-0', params);
    for (let i = 0; i < 205; i++) {
      cache.set(cache.key(`phrase-${i}`, params), audio);
    }

    expect(cache.stats().entries).toBeLessThanOrEqual(200);
    expect(cache.get(first)).toBeNull();
  });

  it('refreshes an entry on read so a hot phrase is not evicted', () => {
    const hot = cache.key('hot', params);
    cache.set(hot, audio);

    for (let i = 0; i < 199; i++) {
      cache.set(cache.key(`cold-${i}`, params), audio);
      // Touching it keeps it at the recent end of the order.
      cache.get(hot);
    }
    cache.set(cache.key('one-more', params), audio);

    expect(cache.get(hot)).toEqual(audio);
  });

  it('never evicts a pinned filler under LRU pressure', () => {
    const filler = cache.key(VOICE_FILLERS[0], params);
    cache.pin(filler, audio);

    for (let i = 0; i < 250; i++) {
      cache.set(cache.key(`noise-${i}`, params), audio);
    }

    // Its entire value is being instant; an evicted filler would pay a full
    // round-trip at the exact moment the design promised zero.
    expect(cache.get(filler)).toEqual(audio);
    expect(cache.hasPinned(filler)).toBe(true);
  });
});

describe('VexiSpeechService', () => {
  let service: VexiSpeechService;
  let cache: VexiSpeechCache;
  let aiEngine: { runSpeech: jest.Mock };
  let prisma: { ai_engine_applications: { findUnique: jest.Mock } };
  let settings: { getStoreCurrency: jest.Mock };

  const params = {
    model: 'gpt-4o-mini-tts',
    voice: 'shimmer',
    format: 'mp3',
    speed: 1,
    // Obligatorio desde que el volumen entro a la clave de cache: un params
    // sin vol produce una clave distinta a la que warmFillers pinneo.
    vol: 1,
  };

  beforeEach(() => {
    cache = new VexiSpeechCache();
    aiEngine = {
      runSpeech: jest.fn().mockResolvedValue({
        success: true,
        audioBase64: 'AAAA',
        contentType: 'audio/mpeg',
      }),
    };
    prisma = { ai_engine_applications: { findUnique: jest.fn() } };
    settings = { getStoreCurrency: jest.fn().mockResolvedValue('COP') };

    service = new VexiSpeechService(
      prisma as any,
      aiEngine as any,
      cache,
      settings as any,
    );
  });

  describe('resolveParams', () => {
    it('reads the voice an operator configured', async () => {
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({
        metadata: {
          speech: { voice: 'coral', response_format: 'wav', speed: 1.1 },
        },
        config: { model_id: 'gpt-4o-mini-tts' },
      });

      await expect(service.resolveParams()).resolves.toEqual({
        model: 'gpt-4o-mini-tts',
        voice: 'coral',
        format: 'wav',
        speed: 1.1,
        // Sin vol en la metadata, así que cae al default del proveedor. El
        // respaldo NO sube el volumen a propósito: un respaldo que lo subiera
        // escondería que la configuración real no se pudo leer.
        vol: 1,
      });
    });

    it('reads the volume an operator configured', async () => {
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({
        metadata: {
          speech: { voice: 'coral', response_format: 'wav', speed: 1, vol: 1.5 },
        },
        config: { model_id: 'gpt-4o-mini-tts' },
      });

      // El volumen entra a la clave de caché, así que leerlo mal no da audio
      // silencioso: da el audio VIEJO, y el ajuste parece no hacer nada.
      await expect(service.resolveParams()).resolves.toMatchObject({ vol: 1.5 });
    });

    it('falls back to the seeded defaults when the row is missing', async () => {
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce(null);

      // Must match the seed exactly: a key built from `undefined` would miss
      // every entry the warm pass created.
      await expect(service.resolveParams()).resolves.toEqual(params);
    });

    it('ignores a blank or non-positive override', async () => {
      prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({
        metadata: { speech: { voice: '   ', response_format: '', speed: 0 } },
        config: null,
      });

      // Zero speed is not "unset", it is invalid — and `Number('')` is 0, so a
      // truthiness check here would silently accept a cleared field as a value.
      await expect(service.resolveParams()).resolves.toEqual(params);
    });

    it('survives a lookup failure without killing the turn', async () => {
      prisma.ai_engine_applications.findUnique.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(service.resolveParams()).resolves.toEqual(params);
    });
  });

  describe('synthesize', () => {
    it('sends stripped prose while the caller keeps the markers', async () => {
      await service.synthesize('El **total** es 1.500 pesos.', params);

      expect(aiEngine.runSpeech).toHaveBeenCalledWith(
        'vexi_voice_tts',
        { text: 'El total es 1.500 pesos.' },
        expect.objectContaining({ voice: 'shimmer', responseFormat: 'mp3' }),
      );
    });

    it('serves the second identical segment from cache', async () => {
      await service.synthesize('Listo.', params);
      await service.synthesize('Listo.', params);

      expect(aiEngine.runSpeech).toHaveBeenCalledTimes(1);
    });

    it('skips a segment that cleans down to nothing', async () => {
      await expect(service.synthesize('**', params)).resolves.toBeNull();
      expect(aiEngine.runSpeech).not.toHaveBeenCalled();
    });

    it('degrades to text-only instead of throwing when the provider fails', async () => {
      aiEngine.runSpeech.mockResolvedValueOnce({
        success: false,
        error: 'AI_PROVIDER_002',
      });

      // A failed synthesis is a worse voice experience; a thrown error would
      // take the captions down with it.
      await expect(service.synthesize('Hola.', params)).resolves.toBeNull();
    });

    it('does not cache a failed synthesis', async () => {
      aiEngine.runSpeech.mockResolvedValueOnce({ success: false, error: 'x' });

      await service.synthesize('Hola.', params);
      await service.synthesize('Hola.', params);

      expect(aiEngine.runSpeech).toHaveBeenCalledTimes(2);
    });
  });

  describe('fillers', () => {
    it('warms the bank once and is free the second time', async () => {
      prisma.ai_engine_applications.findUnique.mockResolvedValue(null);

      const first = await service.warmFillers();
      expect(first.synthesized).toBe(VOICE_FILLERS.length);
      expect(aiEngine.runSpeech).toHaveBeenCalledTimes(VOICE_FILLERS.length);

      aiEngine.runSpeech.mockClear();
      const second = await service.warmFillers();

      expect(second.synthesized).toBe(0);
      expect(second.alreadyWarm).toBe(VOICE_FILLERS.length);
      expect(aiEngine.runSpeech).not.toHaveBeenCalled();
    });

    it('never picks the phrase it just used', () => {
      let previous = service.pickFiller(null);

      for (let i = 0; i < VOICE_FILLERS.length * 2; i++) {
        const next = service.pickFiller(previous);
        // Repetition is what makes filler read as a tic instead of as a person
        // thinking.
        expect(next).not.toBe(previous);
        previous = next;
      }
    });

    it('spreads across the bank instead of walking a fixed cycle', () => {
      // Properties, not a sequence: the pick is random, so asserting an exact
      // order would be asserting the PRNG. What matters is that no consecutive
      // pair repeats and that the pool is genuinely being used — the previous
      // implementation satisfied the first and failed the second, walking the
      // bank in order so that four picks told you the fifth.
      const seen: string[] = [];
      let previous: string | null = null;

      for (let i = 0; i < 20; i++) {
        const next = service.pickFiller(previous);
        expect(next).not.toBe(previous);
        seen.push(next);
        previous = next;
      }

      expect(new Set(seen).size).toBeGreaterThanOrEqual(5);
      // Every pick has to be a real phrase from the bank, never undefined from
      // an index walked off the end.
      for (const phrase of seen) {
        expect(VOICE_FILLERS).toContain(phrase);
      }
    });

    it('always answers with something speakable, even for an unknown previous', () => {
      // A bank that changed between deploys leaves conversations remembering a
      // phrase that no longer exists. Filtering it out must not empty the pool.
      const phrase = service.pickFiller('una frase que ya no está en el banco');

      expect(VOICE_FILLERS).toContain(phrase);
    });

    it('remembers the last phrase per conversation, not globally', () => {
      service.rememberFiller(1, VOICE_FILLERS[0]);
      service.rememberFiller(2, VOICE_FILLERS[3]);

      // Two people talking at once must not shape each other's rotation.
      expect(service.lastFiller(1)).toBe(VOICE_FILLERS[0]);
      expect(service.lastFiller(2)).toBe(VOICE_FILLERS[3]);
      expect(service.lastFiller(99)).toBeNull();
    });

    it('ignores a null phrase so a failed synthesis does not erase the guard', () => {
      service.rememberFiller(1, VOICE_FILLERS[0]);
      service.rememberFiller(1, null);

      // `usedFiller()` is null when the bank could not be synthesized. Writing
      // that through would drop the repeat guard for the next turn.
      expect(service.lastFiller(1)).toBe(VOICE_FILLERS[0]);
    });

    it('bounds the memory so a long-lived process cannot grow it forever', () => {
      for (let id = 1; id <= 600; id++) {
        service.rememberFiller(id, VOICE_FILLERS[id % VOICE_FILLERS.length]);
      }

      // Oldest-first eviction: the earliest conversations are gone, the recent
      // ones survive. Losing an old one costs at most one audible repeat.
      expect(service.lastFiller(1)).toBeNull();
      expect(service.lastFiller(600)).toBe(
        VOICE_FILLERS[600 % VOICE_FILLERS.length],
      );
    });

    it('serves a warmed filler without touching the provider', async () => {
      prisma.ai_engine_applications.findUnique.mockResolvedValue(null);
      await service.warmFillers();
      aiEngine.runSpeech.mockClear();

      const audio = await service.fillerAudio(VOICE_FILLERS[0], params);

      expect(audio).toEqual({
        audioBase64: 'AAAA',
        contentType: 'audio/mpeg',
      });
      expect(aiEngine.runSpeech).not.toHaveBeenCalled();
    });
  });
});
