import { Injectable } from '@nestjs/common';
import { paperToContainerPx, PageBoxMm } from '../lib/mm-to-px';

/**
 * [print-editor-dsk P2.2] Single render path for print previews and the
 * document-print service. Wraps raw HTML from the composer with an
 * explicit `.vendix-print-page` container that has concrete pixel
 * dimensions — replacing the previous double-render (srcdoc + doc.write)
 * and the reverse-engineered format detection in `document-print.service.ts`.
 */
@Injectable()
export class PrintDocumentRendererService {
  /**
   * Wrap HTML body in a sized container. Returns the full document string.
   */
  render(opts: { html: string; paper: PageBoxMm; copies?: number }): string {
    const box = paperToContainerPx(opts.paper);
    const copies = opts.copies ?? 1;
    const heightCss = box.height_px
      ? `${box.height_px}px`
      : 'auto';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 0; background: #fff; }
  .vendix-print-page {
    width: ${box.width_px}px;
    height: ${heightCss};
    min-height: ${box.is_roll ? '50px' : 'auto'};
    margin: 0 auto;
    background: #fff;
    box-sizing: border-box;
  }
  .vendix-print-page > * { max-width: 100%; }
</style>
</head>
<body>
${box.is_roll ? this.repeatForCopies(opts.html, copies) : opts.html}
</body>
</html>`;
  }

  private repeatForCopies(html: string, copies: number): string {
    if (copies <= 1) return html;
    return Array.from({ length: copies }, () => html).join(
      '<div style="break-after: page; page-break-after: always;"></div>',
    );
  }
}
