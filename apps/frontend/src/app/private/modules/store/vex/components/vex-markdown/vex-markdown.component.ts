import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { marked } from 'marked';

/**
 * Full markdown for Vex answers: GFM tables, code, lists.
 *
 * `marked` renders the HTML and Angular's `[innerHTML]` binding sanitizes it —
 * no `bypassSecurityTrustHtml` anywhere near model output. Streaming text
 * re-parses on each chunk; `marked` handles partial input gracefully enough
 * for a chat view (an unclosed fence renders as plain text until it closes).
 */
@Component({
  selector: 'vendix-vex-markdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="vex-md" [innerHTML]="html()"></div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      .vex-md {
        font-size: 0.925rem;
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
        font-size: 1.2rem;
      }

      .vex-md h2 {
        font-size: 1.1rem;
      }

      .vex-md h3 {
        font-size: 1rem;
      }

      .vex-md h4 {
        font-size: 0.925rem;
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
        text-underline-offset: 2px;
      }

      .vex-md code {
        font-family:
          ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.85em;
        padding: 0.1em 0.35em;
        border-radius: 6px;
        background: rgba(var(--color-text-primary-rgb, 0, 0, 0), 0.07);
      }

      .vex-md pre {
        margin: 0 0 0.65em;
        padding: 0.8em 1em;
        border-radius: 12px;
        overflow-x: auto;
        background: rgba(var(--color-text-primary-rgb, 0, 0, 0), 0.06);
        border: 1px solid var(--color-border);
      }

      .vex-md pre code {
        padding: 0;
        background: transparent;
        font-size: 0.82rem;
        line-height: 1.55;
      }

      .vex-md blockquote {
        margin: 0 0 0.65em;
        padding: 0.1em 0 0.1em 0.9em;
        border-left: 3px solid var(--color-primary);
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
        font-size: 0.85rem;
      }

      .vex-md th,
      .vex-md td {
        padding: 0.45em 0.7em;
        border: 1px solid var(--color-border);
        text-align: left;
        white-space: nowrap;
      }

      .vex-md thead th {
        background: rgba(var(--color-text-primary-rgb, 0, 0, 0), 0.05);
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
    `,
  ],
})
export class VexMarkdownComponent {
  readonly content = input<string>('');

  readonly html = computed(() => {
    const raw = this.content();
    if (!raw) return '';
    try {
      return marked.parse(raw, { gfm: true, breaks: true }) as string;
    } catch {
      return raw;
    }
  });
}
