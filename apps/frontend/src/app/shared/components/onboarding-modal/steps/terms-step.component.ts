/** REBUILD TRIGGER 2 **/
import {
  Component,
  Output,
  EventEmitter,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ButtonComponent } from '../../button/button.component';
import { IconComponent } from '../../icon/icon.component';
import {
  LegalService,
  LegalDocument,
} from '../../../../core/services/legal.service';
import { ToastService } from '../../toast/toast.service';
import { finalize } from 'rxjs/operators';

// Use a more flexible import for marked to avoid compilation issues in monorepo
import { marked } from 'marked';

interface DocumentStatus extends LegalDocument {
  accepted: boolean;
  loading: boolean;
}

@Component({
  selector: 'app-terms-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      /* ============================================
         MOBILE-FIRST TERMS STEP DESIGN
         Inspired by modern mobile onboarding patterns
         ============================================ */

      :host {
        display: block;
        height: 100%;
      }

      .terms-step {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-height: 70vh;
        overflow: hidden;
      }

      /* Scrollable content area */
      .terms-content {
        flex: 1;
        overflow-y: auto;
        padding: 0 0.5rem;
        -webkit-overflow-scrolling: touch;
      }

      /* Custom scrollbar for webkit browsers */
      .terms-content::-webkit-scrollbar {
        width: 4px;
      }

      .terms-content::-webkit-scrollbar-thumb {
        background: var(--color-border);
        border-radius: 10px;
      }

      /* ============================================
         HEADER SECTION
         ============================================ */

      .terms-header {
        text-align: center;
        padding: 0.75rem 0;
      }

      .terms-icon-wrapper {
        margin-bottom: 0.5rem;
      }

      .terms-icon-bg {
        width: 48px;
        height: 48px;
        background: var(--color-success-light);
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        animation: termsPop 0.6s ease-out;
      }

      @keyframes termsPop {
        0% {
          transform: scale(0);
          opacity: 0;
        }
        50% {
          transform: scale(1.1);
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }

      .terms-icon {
        color: var(--color-success);
      }

      .terms-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0 0 0.25rem 0;
      }

      .terms-subtitle {
        font-size: 0.75rem;
        color: var(--color-text-muted);
        line-height: 1.5;
        margin: 0;
        padding: 0 0.5rem;
      }

      /* ============================================
         LOADING & EMPTY STATES
         ============================================ */

      .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 2rem;
        text-align: center;
      }

      .loading-text {
        margin-top: 0.75rem;
        font-size: 0.875rem;
        color: var(--color-text-muted);
      }

      .empty-state {
        text-align: center;
        padding: 2rem;
      }

      .empty-text {
        color: var(--color-text-secondary);
        font-size: 0.875rem;
        margin-bottom: 1rem;
      }

      /* ============================================
         DOCUMENT CARDS
         ============================================ */

      .terms-documents {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .document-card {
        background: var(--color-surface);
        border: 2px solid var(--color-border);
        border-radius: 1rem;
        padding: 1rem;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: left;
      }

      .document-card:hover {
        border-color: color-mix(in srgb, var(--color-success) 50%, transparent);
      }

      .document-card:active {
        transform: scale(0.98);
      }

      .document-card.selected {
        border-color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 5%, var(--color-surface));
      }

      .card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }

      .card-title-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex: 1;
        min-width: 0;
      }

      .card-icon {
        width: 32px;
        height: 32px;
        background: var(--color-success-light);
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .card-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Checkbox styling for touch-friendly interaction */
      .card-checkbox {
        position: relative;
        width: 24px;
        height: 24px;
        flex-shrink: 0;
      }

      .card-checkbox input {
        position: absolute;
        opacity: 0;
        width: 100%;
        height: 100%;
        cursor: pointer;
        z-index: 1;
      }

      .checkbox-visual {
        width: 24px;
        height: 24px;
        border: 2px solid var(--color-border);
        border-radius: 0.375rem;
        background: var(--color-surface);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .card-checkbox input:checked + .checkbox-visual {
        background: var(--color-success);
        border-color: var(--color-success);
      }

      .checkbox-icon {
        opacity: 0;
        transform: scale(0.5);
        transition: all 0.2s ease;
      }

      .card-checkbox input:checked + .checkbox-visual .checkbox-icon {
        opacity: 1;
        transform: scale(1);
      }

      .card-meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.375rem;
      }

      .version-badge {
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        background: var(--color-background);
        padding: 0.25rem 0.375rem;
        border-radius: 0.25rem;
        color: var(--color-text-muted);
        font-family: monospace;
      }

      .view-link {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--color-success);
        display: flex;
        align-items: center;
        gap: 0.125rem;
        margin-left: auto;
        cursor: pointer;
        transition: opacity 0.2s ease;
      }

      .view-link:hover {
        opacity: 0.8;
      }

      .card-hint {
        font-size: 0.625rem;
        color: var(--color-text-muted);
        line-height: 1.4;
      }

      .card-loading {
        margin-left: 0.5rem;
      }

      /* ============================================
         DOCUMENT VIEWER
         ============================================ */

      .document-viewer {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 1rem;
        overflow: hidden;
        max-height: 40vh;
        display: flex;
        flex-direction: column;
        margin-bottom: 1rem;
      }

      .viewer-header {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-background);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }

      .viewer-title {
        font-weight: 700;
        font-size: 0.875rem;
        color: var(--color-text-primary);
      }

      .viewer-version {
        font-size: 0.625rem;
        color: var(--color-text-muted);
        font-family: monospace;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .viewer-body {
        flex: 1;
        padding: 1rem;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }

      /* Prose styling for markdown content */
      .viewer-body :global(h1),
      .viewer-body :global(h2),
      .viewer-body :global(h3) {
        color: var(--color-text-primary);
        margin-top: 1rem;
        margin-bottom: 0.5rem;
      }

      .viewer-body :global(h1) {
        font-size: 1.25rem;
      }

      .viewer-body :global(h2) {
        font-size: 1.125rem;
      }

      .viewer-body :global(h3) {
        font-size: 1rem;
      }

      .viewer-body :global(p) {
        color: var(--color-text-secondary);
        font-size: 0.875rem;
        line-height: 1.6;
        margin-bottom: 0.75rem;
      }

      .viewer-body :global(ul),
      .viewer-body :global(ol) {
        padding-left: 1.25rem;
        margin-bottom: 0.75rem;
      }

      .viewer-body :global(li) {
        color: var(--color-text-secondary);
        font-size: 0.875rem;
        line-height: 1.6;
        margin-bottom: 0.25rem;
      }

      /* ============================================
         DESKTOP RESPONSIVE ADJUSTMENTS
         ============================================ */

      @media (min-width: 768px) {
        .terms-step {
          max-height: none;
        }

        .terms-content {
          padding: 0 1rem;
        }

        .terms-header {
          padding: 1rem 0;
        }

        .terms-icon-bg {
          width: 56px;
          height: 56px;
        }

        .terms-title {
          font-size: 1.5rem;
        }

        .terms-subtitle {
          font-size: 0.875rem;
          max-width: 400px;
          margin: 0 auto;
          padding: 0;
        }

        /* Two-column layout for desktop */
        .terms-layout {
          display: grid;
          grid-template-columns: 350px 1fr;
          gap: 1.5rem;
          margin-bottom: 1rem;
        }

        .terms-documents {
          margin-bottom: 0;
        }

        .document-card {
          padding: 1.25rem;
        }

        .card-title {
          font-size: 1rem;
        }

        .card-hint {
          font-size: 0.6875rem;
        }

        .document-viewer {
          max-height: 400px;
          margin-bottom: 0;
        }

        .viewer-header {
          padding: 1rem 1.25rem;
        }

        .viewer-title {
          font-size: 1rem;
        }

        .viewer-body {
          padding: 1.25rem;
        }

      }
    `,
  ],
  template: `
    <div class="terms-step">
      <!-- Scrollable Content -->
      <div class="terms-content">
        <!-- Header -->
        <div class="terms-header">
          <div class="terms-icon-wrapper">
            <div class="terms-icon-bg">
              <app-icon name="shield-check" size="28" class="terms-icon"></app-icon>
            </div>
          </div>
          <h2 class="terms-title">Documentos Legales</h2>
          <p class="terms-subtitle">
            Revisa y acepta los términos del servicio y políticas de privacidad
            para activar tu cuenta.
          </p>
        </div>

        <!-- Loading State -->
        <div *ngIf="loading" class="loading-state">
          <app-icon name="loader-2" [spin]="true" size="32"></app-icon>
          <p class="loading-text">Cargando documentos...</p>
        </div>

        <!-- Empty State -->
        <div *ngIf="!loading && documents.length === 0" class="empty-state">
          <p class="empty-text">No hay documentos pendientes por aceptar.</p>
          <app-button variant="primary" (clicked)="onComplete()">
            Continuar
          </app-button>
        </div>

        <!-- Documents Layout -->
        <div
          *ngIf="!loading && documents.length > 0"
          class="terms-layout"
        >
          <!-- Document List -->
          <div class="terms-documents">
            <div
              *ngFor="let doc of documents"
              class="document-card"
              [class.selected]="selectedDoc()?.id === doc.id"
              (click)="selectDocument(doc)"
            >
              <div class="card-header">
                <div class="card-title-row">
                  <div class="card-icon">
                    <app-icon name="file-text" size="18" class="terms-icon"></app-icon>
                  </div>
                  <h4 class="card-title">{{ doc.title }}</h4>
                </div>

                <div
                  class="card-checkbox"
                  (click)="$event.stopPropagation(); toggleAcceptance(doc)"
                >
                  <input
                    type="checkbox"
                    [id]="'doc-' + doc.id"
                    [checked]="doc.accepted"
                    [disabled]="doc.loading"
                    (click)="$event.stopPropagation()"
                    (change)="toggleAcceptance(doc)"
                  />
                  <div class="checkbox-visual">
                    <app-icon
                      name="check"
                      size="14"
                      color="#ffffff"
                      class="checkbox-icon"
                    ></app-icon>
                  </div>
                </div>

                <app-icon
                  *ngIf="doc.loading"
                  name="loader-2"
                  [spin]="true"
                  size="14"
                  class="card-loading"
                ></app-icon>
              </div>

              <div class="card-meta">
                <span class="version-badge">v{{ doc.version }}</span>
                <span
                  class="view-link"
                  (click)="$event.stopPropagation(); selectDocument(doc)"
                >
                  Ver documento
                  <app-icon name="chevron-right" size="12"></app-icon>
                </span>
              </div>

              <p class="card-hint">
                Haz clic en el checkbox para aceptar los términos
              </p>
            </div>
          </div>

          <!-- Document Viewer -->
          <div
            *ngIf="selectedDoc()"
            #documentViewer
            class="document-viewer animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div class="viewer-header">
              <span class="viewer-title">{{ selectedDoc()?.title }}</span>
              <span class="viewer-version">
                Versión {{ selectedDoc()?.version }}
              </span>
            </div>
            <div
              class="viewer-body prose prose-sm max-w-none prose-slate"
              [innerHTML]="renderedContent()"
            ></div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class TermsStepComponent implements OnInit {
  @Output() completed = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  private legalService = inject(LegalService);
  private toastService = inject(ToastService);
  readonly cdr = inject(ChangeDetectorRef);
  private sanitizer = inject(DomSanitizer);

  loading = true;
  submitting = false;
  documents: DocumentStatus[] = [];

  // Selected document for viewing
  selectedDoc = signal<DocumentStatus | null>(null);

  @ViewChild('documentViewer') documentViewer?: ElementRef<HTMLElement>;

  // Rendered HTML from Markdown
  renderedContent = computed(() => {
    const doc = this.selectedDoc();
    if (!doc || !doc.content) return '';

    try {
      // Use the standard parse method from the library
      const html = marked.parse(doc.content);
      return this.sanitizer.bypassSecurityTrustHtml(html as string);
    } catch (e) {
      console.error('Error parsing markdown', e);
      return 'Error al cargar el contenido.';
    }
  });

  get allAccepted(): boolean {
    return this.documents.every((doc) => doc.accepted);
  }

  ngOnInit() {
    this.loadPendingTerms();
  }

  loadPendingTerms() {
    this.loading = true;
    this.legalService
      .getPendingTerms()
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (docs) => {
          this.documents = docs.map((doc) => ({
            ...doc,
            accepted: false,
            loading: false,
          }));

          // If no documents are pending, automatically proceed
          if (this.documents.length === 0) {
            this.completed.emit();
          } else {
            // Auto-select first document
            this.selectDocument(this.documents[0]);
          }
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.error('Error loading terms', err);
          this.toastService.error(
            'Error al cargar los términos y condiciones. Por favor intenta nuevamente.',
          );
          this.cdr.markForCheck();
        },
      });
  }

  selectDocument(doc: DocumentStatus) {
    this.selectedDoc.set(doc);
    this.cdr.markForCheck();

    // Scroll to document viewer after a brief delay to allow rendering
    setTimeout(() => {
      this.documentViewer?.nativeElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 100);
  }

  toggleAcceptance(doc: DocumentStatus) {
    doc.accepted = !doc.accepted;
    this.cdr.markForCheck();
  }

  acceptAllAndSubmit() {
    // Mark all documents as accepted
    this.documents.forEach((doc) => {
      doc.accepted = true;
    });
    this.cdr.markForCheck();

    // Submit all acceptances
    this.submitAcceptances();
  }

  submitAcceptances() {
    if (!this.allAccepted) return;

    this.submitting = true;
    this.cdr.markForCheck();

    const pendingDocs = this.documents.filter((d) => !d.loading);

    const acceptanceRequests = pendingDocs.map((doc) => {
      doc.loading = true;
      this.cdr.markForCheck();
      return this.legalService
        .acceptDocument(doc.id, 'onboarding')
        .toPromise()
        .then(() => {
          doc.loading = false;
          this.cdr.markForCheck();
          return { success: true, id: doc.id };
        })
        .catch((err) => {
          doc.loading = false;
          this.cdr.markForCheck();
          return { success: false, id: doc.id, error: err };
        });
    });

    Promise.all(acceptanceRequests).then((results) => {
      const failures = results.filter((r) => !r.success);

      if (failures.length === 0) {
        this.toastService.success('Documentos aceptados correctamente');
        this.completed.emit();
      } else {
        this.submitting = false;
        this.toastService.error(
          'Hubo un error al aceptar algunos documentos. Por favor intenta nuevamente.',
        );
      }
      this.cdr.markForCheck();
    });
  }

  onComplete() {
    this.completed.emit();
  }

  onBack() {
    this.back.emit();
  }
}
