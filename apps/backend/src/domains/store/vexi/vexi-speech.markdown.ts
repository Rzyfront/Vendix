/**
 * Markdown removal for the audio branch.
 *
 * Captions and history keep whatever the chat produced — the reader wants the
 * formatting, the listener cannot hear it. Only the text handed to the
 * segmenter (and from there to the synthesizer) is cleaned.
 *
 * The cleaning runs over the WHOLE answer before it is cut into segments, not
 * per segment. Per segment was wrong: a fenced code block or a ```json payload
 * split across two segments has no closing fence in the first one, so the
 * pattern never matched and the code was dictated aloud. `SpeechMarkdownFilter`
 * holds back any construct still open in the stream and releases it only once
 * it is complete, so every pattern always sees its full shape.
 */

/**
 * Removes markdown but keeps whitespace and line breaks, so it can run on
 * consecutive slices of a stream and the slices still join into prose.
 *
 * Deletion rather than pairing for the emphasis markers: an unclosed `**` at a
 * slice boundary is normal, and no asterisk is ever spoken.
 */
export function cleanMarkdownForSpeech(text: string): string {
  return (
    text
      // Code is not prose. Reading it aloud is never what the listener wanted.
      .replace(/```[\s\S]*?```/g, ' ')
      // Keep the label, drop the target — nobody wants a URL dictated.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // A table separator row is pure layout.
      .replace(/^[ \t]*\|[-:\s|]*\|[ \t]*$/gm, ' ')
      // Remaining pipes separate cells; a space reads as the pause they imply.
      .replace(/\|/g, ' ')
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
      // The trailing space is load-bearing in both list patterns: it is what
      // distinguishes the marker "1. " from the amount "1.500".
      .replace(/^[ \t]*[-*+][ \t]+/gm, '')
      .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
      .replace(/[*_`~]/g, '')
  );
}

/** `cleanMarkdownForSpeech` plus whitespace collapse: one segment of prose. */
export function stripMarkdownForSpeech(text: string): string {
  return cleanMarkdownForSpeech(text).replace(/\s+/g, ' ').trim();
}

/**
 * A line shorter than this is held until it grows or ends: its line-start
 * marker ("### ", "12. ", "> ") cannot be recognised before it is complete.
 */
const LINE_START_WINDOW = 8;

/** An unclosed link longer than this is not a link; release it as text. */
const MAX_PENDING_LINK = 500;

/**
 * Streaming front end of the audio branch: takes raw chat text as it arrives
 * and returns cleaned text that is safe to cut, holding back whatever might
 * still turn out to be markup (an open fence, a half-arrived link, the first
 * characters of a line, a table row).
 */
export class SpeechMarkdownFilter {
  private full = '';
  private released = 0;

  push(chunk: string): string {
    this.full += chunk;
    return this.release(false);
  }

  /** End of turn: whatever is left is released, open constructs included. */
  flush(): string {
    return this.release(true);
  }

  private release(force: boolean): string {
    const end = force ? this.full.length : this.safeEnd();
    if (end <= this.released) return '';

    const slice = this.full.slice(this.released, end);
    const atLineStart =
      this.released === 0 || this.full[this.released - 1] === '\n';
    this.released = end;

    // A slice that starts mid-line must not have its first characters read as
    // a line-start marker: a sentinel takes the `^` position and is removed.
    if (atLineStart) return cleanMarkdownForSpeech(slice);
    return cleanMarkdownForSpeech(`\u0000${slice}`).replace(/^\u0000/, '');
  }

  private safeEnd(): number {
    const full = this.full;
    let end = full.length;

    // 1. An open fence holds everything from its opening backticks.
    let cursor = this.released;
    for (;;) {
      const open = full.indexOf('```', cursor);
      if (open === -1) break;
      const close = full.indexOf('```', open + 3);
      if (close === -1) {
        end = Math.min(end, open);
        break;
      }
      cursor = close + 3;
    }

    // 2. Trailing backticks may be the start of a fence still forming.
    while (end > this.released && full[end - 1] === '`') end--;

    // 3. A link whose target has not closed yet.
    const bracket = full.lastIndexOf('[', end - 1);
    if (bracket >= this.released) {
      const start = bracket > 0 && full[bracket - 1] === '!' ? bracket - 1 : bracket;
      const tail = full.slice(bracket, end);
      const open =
        /^\[[^\]\n]*$/.test(tail) ||
        /^\[[^\]\n]*\]$/.test(tail) ||
        /^\[[^\]\n]*\]\([^)\n]*$/.test(tail);
      if (open && tail.length < MAX_PENDING_LINK) end = Math.max(this.released, start);
    }

    // 4. The current line: too short to know its marker, or a table row.
    const lineStart = full.lastIndexOf('\n', end - 1) + 1;
    if (lineStart >= this.released) {
      const line = full.slice(lineStart, end);
      if (line.length < LINE_START_WINDOW || line.trimStart().startsWith('|')) {
        end = lineStart;
      }
    }

    return Math.max(end, this.released);
  }
}
