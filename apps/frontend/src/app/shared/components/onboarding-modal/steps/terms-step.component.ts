/** REBUILD TRIGGER 2 **/
import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  signal,
  computed,
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
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

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
      .terms-step {
        padding: 1rem 0;
        width: 100%;
        max-width: 1200px; /* Wider for XL modal */
        margin: 0 auto;
      }

      .terms-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .terms-icon-wrapper {
        width: 48px;
        height: 48px;
        background: var(--color-primary-light);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 1rem;
      }

      .terms-icon {
        color: var(--color-primary);
      }

      .terms-title {
        font-size: var(--fs-lg);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
      }

      .terms-description {
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
      }

      .terms-layout {
        display: grid;
        grid-template-columns: 1fr;
        gap: 2rem;
      }

      @media (min-width: 1024px) {
        .terms-layout.has-selection {
          grid-template-columns: 350px 1fr;
        }
      }

      .terms-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .term-item {
        display: flex;
        align-items: flex-start;
        padding: 1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        transition: all 0.2s ease;
        background: var(--color-surface);
        cursor: pointer;
      }

      .term-item:hover {
        border-color: var(--color-primary);
        background: var(--color-background-hover);
      }

      .term-item.is-selected {
        border-color: var(--color-primary);
        ring: 1px solid var(--color-primary);
        background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.05);
      }

      .term-checkbox {
        margin-top: 0.25rem;
        margin-right: 1rem;
        width: 1.15rem;
        height: 1.15rem;
        cursor: pointer;
      }

      .term-content {
        flex: 1;
        min-width: 0;
      }

      .term-label {
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        display: block;
        margin-bottom: 0.25rem;
        font-size: var(--fs-sm);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .term-acceptance {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 11px;
        color: var(--color-text-secondary);
        padding: 0.25rem 0;
      }

      .term-acceptance:hover {
        color: var(--color-primary);
      }

      .term-details {
        font-size: 11px;
        color: var(--color-text-secondary);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .view-action {
        color: var(--color-primary);
        font-size: 11px;
        font-weight: var(--fw-medium);
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-left: auto;
      }

      .view-action:hover {
        text-decoration: underline;
      }

      .document-viewer {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-surface);
        display: flex;
        flex-direction: column;
        height: 500px;
        overflow: hidden;
      }

      .viewer-header {
        padding: 0.75rem 1.25rem;
        border-b: 1px solid var(--color-border);
        background: var(--color-background);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .viewer-title {
        font-weight: var(--fw-bold);
        font-size: var(--fs-sm);
        color: var(--color-text-primary);
      }

      .viewer-body {
        flex: 1;
        padding: 1.5rem;
        overflow-y: auto;
      }

      .terms-actions {
        display: none; /* Moved to parent modal footer */
      }

      .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 2rem;
      }

      .empty-state {
        text-align: center;
        padding: 2rem;
        color: var(--color-text-secondary);
      }
    `,
  ],
  template: `
    <div class="terms-step">
      <div class="terms-header">
        <div class="terms-icon-wrapper">
          <app-icon name="shield-check" size="24" class="terms-icon"></app-icon>
        </div>
        <h2 class="terms-title">Documentos Legales</h2>
        <p class="terms-description">
          Revisa y acepta los términos del servicio y políticas de privacidad
          para activar tu cuenta.
        </p>
      </div>

      <div *ngIf="loading" class="loading-state">
        <app-icon name="loader-2" [spin]="true" size="32"></app-icon>
        <p class="mt-2 text-sm text-gray-500">Cargando documentos...</p>
      </div>

      <div *ngIf="!loading && documents.length === 0" class="empty-state">
        <p>No hay documentos pendientes por aceptar.</p>
        <div class="mt-4">
          <app-button variant="primary" (clicked)="onComplete()"
            >Continuar</app-button
          >
        </div>
      </div>

      <div
        *ngIf="!loading && documents.length > 0"
        class="terms-layout"
        [class.has-selection]="!!selectedDoc()"
      >
        <!-- Document List -->
        <div class="terms-list">
          <div
            *ngFor="let doc of documents"
            class="term-item"
            [class.is-selected]="selectedDoc()?.id === doc.id"
            (click)="selectDocument(doc)"
          >
            <div class="term-content">
              <span class="term-label">{{ doc.title }}</span>
              
              <div 
                class="term-acceptance" 
                (click)="$event.stopPropagation(); doc.accepted = !doc.accepted; cdr.markForCheck()"
              >
                <input
                  type="checkbox"
                  [id]="'doc-' + doc.id"
                  [(ngModel)]="doc.accepted"
                  class="term-checkbox"
                  [disabled]="doc.loading"
                  (click)="$event.stopPropagation()"
                />
                <label [for]="'doc-' + doc.id" class="cursor-pointer">
                  Haz clic aquí para aceptar los términos y condiciones
                </label>
              </div>

              <div class="term-details mt-2">
                <span class="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] font-mono">
                  v{{ doc.version }}
                </span>
                <span 
                  class="view-action cursor-pointer" 
                  (click)="$event.stopPropagation(); selectDocument(doc)"
                >
                  Ver documento
                  <app-icon name="chevron-right" size="12"></app-icon>
                </span>
              </div>
            </div>

            <app-icon
              *ngIf="doc.loading"
              name="loader-2"
              [spin]="true"
              size="14"
              class="text-primary ml-2"
            ></app-icon>
          </div>
        </div>

        <!-- Document Viewer -->
        <div
          *ngIf="selectedDoc()"
          class="document-viewer animate-in fade-in slide-in-from-right-4 duration-300"
        >
          <div class="viewer-header">
            <span class="viewer-title">{{ selectedDoc()?.title }}</span>
            <span
              class="text-[10px] text-text-secondary font-mono uppercase tracking-wider"
            >
              Versión {{ selectedDoc()?.version }}
            </span>
          </div>
          <div
            class="viewer-body prose prose-sm max-w-none prose-slate"
            [innerHTML]="renderedContent()"
          ></div>
        </div>

        <!-- Empty Selection State (if on desktop and nothing selected) -->
        <div
          *ngIf="!selectedDoc() && documents.length > 0"
          class="hidden lg:flex document-viewer items-center justify-center bg-gray-50 border-dashed"
        >
          <div class="text-center p-8">
            <app-icon
              name="file-text"
              size="48"
              class="text-gray-200 mb-4 mx-auto"
            ></app-icon>
            <p class="text-sm text-gray-400">
              Selecciona un documento para leer su contenido completo
            </p>
          </div>
        </div>
      </div>

      <div class="terms-actions" *ngIf="!loading && documents.length > 0">
        <app-button variant="outline" size="sm" (clicked)="onBack()">
          Atrás
        </app-button>
        <app-button
          variant="primary"
          size="sm"
          [disabled]="!allAccepted || submitting"
          (clicked)="submitAcceptances()"
        >
          <span *ngIf="!submitting">Aceptar y Continuar</span>
          <span *ngIf="submitting" class="flex items-center gap-2">
            <app-icon name="loader-2" [spin]="true" size="14"></app-icon>
            Procesando...
          </span>
        </app-button>
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
