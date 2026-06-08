import {
  Component,
  inject,
  computed,
  signal,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';
import { Marked, type Tokens } from 'marked';

import {
  PublicLegalService,
  LegalDocument,
  LegalDocumentType,
} from '../services/public-legal.service';
import { formatDateOnlyUTC } from '../../../shared/utils/date.util';

/**
 * Public generic legal document viewer.
 *
 * Reads the document type from the route `data.documentType`, fetches the
 * active version from the backend, and renders the markdown/HTML content with
 * marked + DomSanitizer. Heading anchors are generated so deep links such as
 * `/legal/terminos#pagos-y-reembolsos` (used by the checkout) scroll into view.
 */
@Component({
  selector: 'app-legal-document-viewer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './legal-document-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalDocumentViewerComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly legalService = inject(PublicLegalService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly viewportScroller = inject(ViewportScroller);

  /** marked instance configured with slugified heading IDs for anchor support. */
  private readonly marked = new Marked({
    renderer: {
      heading(token: Tokens.Heading): string {
        const text = this.parser.parseInline(token.tokens);
        const id = LegalDocumentViewerComponent.slugify(token.text);
        return `<h${token.depth} id="${id}">${text}</h${token.depth}>\n`;
      },
    },
  });

  /** Document type from the route presentation metadata. */
  private readonly documentType = this.route.snapshot.data[
    'documentType'
  ] as LegalDocumentType;

  /** Fragment to scroll to after render (e.g. #pagos-y-reembolsos). */
  private readonly fragment = toSignal(this.route.fragment, {
    initialValue: this.route.snapshot.fragment,
  });

  /**
   * Fetch result bridged to a signal. `loaded` flips to true on success or
   * error (404); the synchronous initial value keeps the loading state until
   * the request settles. A flat object shape (instead of a discriminated union)
   * avoids signal narrowing pitfalls and keeps strict typing clean.
   */
  private readonly result = toSignal(
    this.legalService.getDocument(this.documentType).pipe(
      map((document) => ({
        document: document as LegalDocument | null,
        loaded: true,
      })),
      catchError(() =>
        of({ document: null as LegalDocument | null, loaded: true }),
      ),
    ),
    { initialValue: { document: null as LegalDocument | null, loaded: false } },
  );

  readonly isLoading = computed(() => !this.result().loaded);
  readonly document = computed<LegalDocument | null>(
    () => this.result().document,
  );
  readonly isEmpty = computed(
    () => this.result().loaded && !this.result().document,
  );

  readonly effectiveDate = computed<string>(() => {
    const doc = this.document();
    return doc?.effective_date ? formatDateOnlyUTC(doc.effective_date) : '';
  });

  readonly renderedContent = computed<SafeHtml>(() => {
    const doc = this.document();
    if (!doc?.content) return '';
    try {
      const html = this.marked.parse(doc.content, { async: false });
      return this.sanitizer.bypassSecurityTrustHtml(html);
    } catch (error) {
      console.error('Error rendering legal document', error);
      return '';
    }
  });

  constructor() {
    // After content renders, scroll to the URL fragment anchor if present.
    effect(() => {
      const doc = this.document();
      const fragment = this.fragment();
      if (!doc || !fragment) return;
      // Wait for the rendered HTML to be in the DOM before scrolling.
      queueMicrotask(() => this.viewportScroller.scrollToAnchor(fragment));
    });
  }

  /** Builds a URL-safe heading id from heading text (GFM-style slug). */
  private static slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }
}
