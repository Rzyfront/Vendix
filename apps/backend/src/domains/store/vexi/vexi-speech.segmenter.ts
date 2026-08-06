import {
  MIN_CUT_FRACTION,
  SEGMENT_TARGETS,
  SENTENCE_TOLERANCE,
} from './vexi-speech.constants';

/**
 * Terminators that can close a spoken sentence.
 *
 * The lookahead is the whole trick: requiring whitespace or end-of-string after
 * the terminator is what keeps `3.14` and `1.500` from being read as two
 * numbers, and what keeps a cut from landing inside a decimal. Without it the
 * segmenter is subtly wrong on exactly the content a business assistant emits
 * most — amounts.
 */
const SENTENCE_END = /[.!?…]+(?=\s|$)/g;

/** Clause boundaries, same whitespace guard, same reason. */
const CLAUSE_END = /[,;:](?=\s|$)/g;

const WORD_CHAR = /[\p{L}\p{N}]/u;
const TRAILING_WORD = /([\p{L}\p{N}]+)$/u;

/**
 * Tokens that end in a period without ending a sentence. A false sentence end
 * here costs a needlessly short segment — audible, not wrong — so the list only
 * needs to cover what actually shows up in Spanish business prose.
 */
const ABBREVIATIONS = new Set([
  'sr',
  'sra',
  'srta',
  'dr',
  'dra',
  'ing',
  'lic',
  'av',
  'ud',
  'uds',
  'etc',
  'ej',
  'núm',
  'num',
  'no',
  'pág',
  'pag',
  'vs',
  'aprox',
  'ref',
  'cta',
]);

/** Index just past the first real sentence terminator, or null if none closed. */
export function firstSentenceEnd(text: string): number | null {
  SENTENCE_END.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END.exec(text)) !== null) {
    const end = match.index + match[0].length;

    // Only a lone period can be an abbreviation: "!", "?" and "…" never are,
    // and neither is "..." — a run of dots is a real pause.
    if (match[0] === '.') {
      const word = TRAILING_WORD.exec(text.slice(0, match.index))?.[1];
      if (word && isAbbreviation(word)) continue;
    }

    return end;
  }

  return null;
}

function isAbbreviation(word: string): boolean {
  // A single letter before a period is an initial ("J. Pérez"), never the end
  // of a sentence.
  if (word.length === 1 && WORD_CHAR.test(word)) return true;
  return ABBREVIATIONS.has(word.toLowerCase());
}

/** Index just past the last clause boundary within `text`, or null. */
export function lastClauseEnd(text: string): number | null {
  CLAUSE_END.lastIndex = 0;

  let last: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = CLAUSE_END.exec(text)) !== null) {
    last = match.index + match[0].length;
  }

  return last;
}

export function hasWordCharacter(text: string): boolean {
  return WORD_CHAR.test(text);
}

/**
 * Cuts a streaming answer into speakable segments, growing the budget as it
 * goes.
 *
 * One instance per turn, because the budget depends on how many segments have
 * already been emitted: the first is sized to *start* sound as early as
 * possible, later ones to sound like sentences. See `SEGMENT_TARGETS`.
 *
 * Emits raw text, markers and all. Cleaning for the synthesizer happens
 * downstream and per segment, so captions and history keep the formatting the
 * chat produced while only the audio branch gets stripped prose.
 */
export class VexiSpeechSegmenter {
  private buffer = '';
  private emitted = 0;

  /** Feeds newly streamed text and returns whatever became speakable. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    return this.drain(false);
  }

  /**
   * End of turn: emits the remainder even if it never closed a sentence.
   * Without this a final "…y ya está" with no period would never be spoken.
   */
  flush(): string[] {
    return this.drain(true);
  }

  /** Text held back waiting for a boundary. Diagnostics only. */
  pending(): string {
    return this.buffer;
  }

  private drain(force: boolean): string[] {
    const out: string[] = [];

    // Bounded rather than `while (true)`: every branch of findCut either
    // consumes at least one character or returns null, but a regression that
    // broke that invariant would hang the SSE turn instead of failing a test.
    for (let guard = 0; guard < 10_000; guard++) {
      this.buffer = this.buffer.replace(/^\s+/, '');
      if (!this.buffer) break;

      const cut = this.findCut(force);
      if (cut === null) break;

      const raw = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);

      // Punctuation or stray glyphs on their own are consumed, never spoken:
      // a synthesizer handed "—" either errors or emits a noise.
      if (!hasWordCharacter(raw)) continue;

      out.push(raw);
      this.emitted++;
    }

    return out;
  }

  private currentTarget(): number {
    const index = Math.min(this.emitted, SEGMENT_TARGETS.length - 1);
    return SEGMENT_TARGETS[index];
  }

  private findCut(force: boolean): number | null {
    const target = this.currentTarget();
    const buffer = this.buffer;

    // Best case: a sentence closed and it is not absurdly long. Taking it whole
    // beats honouring the budget — the budget exists to bound latency, and a
    // complete sentence already bounds it.
    const sentence = firstSentenceEnd(buffer);
    if (sentence !== null && sentence <= target * SENTENCE_TOLERANCE) {
      return sentence;
    }

    if (buffer.length < target) {
      // Nothing closed and not enough text to spend the budget on. Waiting is
      // correct mid-stream; at end of turn there is nothing left to wait for.
      return force ? buffer.length : null;
    }

    // Over budget with no usable sentence: cut at the best boundary inside the
    // window. A runaway sentence lands here, which is the point — it must not
    // hold the audio hostage until it finally closes.
    const window = buffer.slice(0, target);
    const floor = Math.floor(target * MIN_CUT_FRACTION);

    const clause = lastClauseEnd(window);
    if (clause !== null && clause > floor) return clause;

    const space = window.lastIndexOf(' ');
    if (space > floor) return space;

    // No boundary worth taking. A hard cut mid-word is the last resort and
    // still better than silence.
    return target;
  }
}
