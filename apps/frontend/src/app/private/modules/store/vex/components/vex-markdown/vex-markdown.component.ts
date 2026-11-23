import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { marked, Token, TokensList } from 'marked';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VEX_COPY } from '../../vex-copy';
import { VexCodeToken, highlightCode, normalizeCodeLang } from './vex-code-highlight.util';

/** A run of prose (sanitized HTML) or one fenced code block. */
type VexMarkdownSegment =
  | { kind: 'html'; html: string }
  | { kind: 'code'; lang: string; text: string; tokens: VexCodeToken[] };

/** How long «Copiado» stays on the button. */
const COPIED_MS = 2000;

/**
 * Full markdown for Vex answers: GFM tables, lists and code.
 *
 * Prose is rendered by `marked` and sanitized by Angular's `[innerHTML]`
 * binding — no `bypassSecurityTrustHtml` anywhere near model output. Fenced
 * code blocks are NOT part of that HTML: each one is a real template node with
 * syntax colouring and a «Copiar» button. Streaming text re-parses on each
 * chunk; an unclosed fence shows as a code block that keeps growing.
 */
@Component({
  selector: 'vendix-vex-markdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconComponent],
  template: `
    @for (segment of segments(); track $index) {
      @if (segment.kind === 'html') {
        <div class="vex-md" [innerHTML]="segment.html"></div>
      } @else {
        <figure class="vex-code">
          <figcaption class="vex-code-bar">
            <span>{{ segment.lang }}</span>
            <app-button
              variant="ghost"
              size="xsm"
              [ariaLabel]="copy.copy_code_aria"
              (clicked)="copyCode($index, segment.text)"
            >
              <app-icon
                slot="icon"
                [name]="copied_index() === $index ? 'check' : 'copy'"
                [size]="12"
              ></app-icon>
              {{ copied_index() === $index ? copy.copied_code : copy.copy_code }}
            </app-button>
          </figcaption>
          <pre><code>@for (token of segment.tokens; track $index) {<span [class]="'vex-tok-' + token.kind">{{ token.text }}</span>}</code></pre>
        </figure>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      .vex-md {
        font-size: var(--fs-base);
        line-height: 1.65;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }

      .vex-md > *:first-child {
        margin-top: 0;
      }

      .vex-md > *:last-child {
        margin-bottom: 0;
      }

      .vex-md p {
        margin: 0 0 0.65em;
      }

      .vex-md h1,
      .vex-md h2,
      .vex-md h3,
      .vex-md h4 {
        margin: 0.9em 0 0.4em;
        font-weight: 600;
        line-height: 1.3;
      }

      .vex-md h1 {
        font-size: var(--fs-xl);
      }

      .vex-md h2 {
        font-size: var(--fs-lg);
      }

      .vex-md h3 {
        font-size: var(--fs-base);
      }

      .vex-md h4 {
        font-size: var(--fs-base);
      }

      .vex-md ul,
      .vex-md ol {
        margin: 0 0 0.65em;
        padding-left: 1.4em;
      }

      .vex-md ul {
        list-style: disc;
      }

      .vex-md ol {
        list-style: decimal;
      }

      .vex-md li {
        margin: 0.2em 0;
      }

      .vex-md li > ul,
      .vex-md li > ol {
        margin-bottom: 0;
      }

      .vex-md a {
        color: var(--color-primary);
        text-decoration: underline;
        text-underline-offset: 0.15em;
      }

      .vex-md code {
        font-family:
          ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.85em;
        padding: 0.1em 0.35em;
        border-radius: var(--radius-sm);
        background: rgba(var(--color-text-primary-rgb), 0.07);
      }

      .vex-md pre {
        margin: 0 0 0.65em;
        padding: 0.8em 1em;
        border-radius: var(--radius-lg);
        overflow-x: auto;
        background: rgba(var(--color-text-primary-rgb), 0.06);
        border: 1px solid var(--color-border);
      }

      .vex-md pre code {
        padding: 0;
        background: transparent;
        font-size: var(--fs-sm);
        line-height: 1.55;
      }

      .vex-md blockquote {
        margin: 0 0 0.65em;
        padding: 0.1em 0 0.1em 0.9em;
        border-left: 0.2em solid var(--color-primary);
        color: var(--color-text-secondary);
      }

      .vex-md blockquote p {
        margin: 0.3em 0;
      }

      .vex-md table {
        display: block;
        width: 100%;
        overflow-x: auto;
        margin: 0 0 0.65em;
        border-collapse: collapse;
        font-size: var(--fs-sm);
      }

      .vex-md th,
      .vex-md td {
        padding: 0.45em 0.7em;
        border: 1px solid var(--color-border);
        text-align: left;
        white-space: nowrap;
      }

      .vex-md thead th {
        background: rgba(var(--color-text-primary-rgb), 0.05);
        font-weight: 600;
      }

      .vex-md hr {
        margin: 0.9em 0;
        border: 0;
        border-top: 1px solid var(--color-border);
      }

      .vex-md input[type='checkbox'] {
        margin-right: 0.4em;
        accent-color: var(--color-primary);
      }

      .vex-code {
        margin: 0 0 0.65em;
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
        background: rgba(var(--color-text-primary-rgb), 0.06);
        overflow: hidden;
      }

      .vex-md + .vex-code,
      .vex-code + .vex-md,
      .vex-code + .vex-code {
        margin-top: 0.65em;
      }

      .vex-code:last-child {
        margin-bottom: 0;
      }

      .vex-code-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5em;
        padding: 0.15em 0.35em 0.15em 1em;
        border-bottom: 1px solid var(--color-border);
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
      }

      .vex-code pre {
        margin: 0;
        padding: 0.8em 1em;
        overflow-x: auto;
        font-family:
          ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: var(--fs-sm);
        line-height: 1.55;
        color: var(--color-text-primary);
      }

      .vex-tok-comment {
        color: var(--color-text-secondary);
        font-style: italic;
      }

      .vex-tok-string {
        color: var(--color-success);
      }

      .vex-tok-number {
        color: var(--color-warning);
      }

      .vex-tok-keyword {
        color: var(--color-primary-on-tint);
        font-weight: var(--fw-semibold);
      }
    `,
  ],
})
export class VexMarkdownComponent {
  readonly content = input<string>('');

  protected readonly copy = VEX_COPY.thread;
  /** Index of the code block whose text was just copied. */
  protected readonly copied_index = signal<number | null>(null);
  private copied_timer: ReturnType<typeof setTimeout> | null = null;

  readonly segments = computed<VexMarkdownSegment[]>(() => {
    const raw = this.content();
    if (!raw) return [];
    try {
      return splitSegments(marked.lexer(raw, { gfm: true, breaks: true }));
    } catch {
      return [{ kind: 'code', lang: '', text: raw, tokens: [{ text: raw, kind: 'plain' }] }];
    }
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.copied_timer) clearTimeout(this.copied_timer);
    });
  }

  protected async copyCode(index: number, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked (permissions, insecure context): nothing was copied.
      return;
    }
    this.copied_index.set(index);
    if (this.copied_timer) clearTimeout(this.copied_timer);
    this.copied_timer = setTimeout(() => this.copied_index.set(null), COPIED_MS);
  }
}

/** Top-level fenced blocks become their own segment; everything between them is one HTML run. */
function splitSegments(tokens: TokensList): VexMarkdownSegment[] {
  const segments: VexMarkdownSegment[] = [];
  let run: Token[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const list = Object.assign(run, { links: tokens.links }) as TokensList;
    const html = marked.parser(list, { gfm: true, breaks: true });
    if (html.trim()) segments.push({ kind: 'html', html });
    run = [];
  };
  for (const token of tokens) {
    if (token.type === 'code') {
      flush();
      const lang = normalizeCodeLang(token.lang as string | undefined);
      const text = String(token.text ?? '');
      segments.push({ kind: 'code', lang, text, tokens: highlightCode(text, lang) });
    } else {
      run.push(token);
    }
  }
  flush();
  return segments;
}
