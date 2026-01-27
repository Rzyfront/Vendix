import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../button/button.component';
import { IconComponent } from '../../icon/icon.component';
import {
  LegalService,
  LegalDocument,
} from '../../../../core/services/legal.service';
import { ToastService } from '../../toast/toast.service';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

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
        max-width: 600px;
        margin: 0 auto;
      }

      .terms-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .terms-icon-wrapper {
        width: 64px;
        height: 64px;
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
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
      }

      .terms-description {
        font-size: var(--fs-base);
        color: var(--color-text-secondary);
      }

      .terms-list {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 2rem;
      }

      .term-item {
        display: flex;
        align-items: flex-start;
        padding: 1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        transition: all 0.2s ease;
        background: var(--color-surface);
      }

      .term-item:hover {
        border-color: var(--color-primary);
        background: var(--color-background-hover);
      }

      .term-checkbox {
        margin-top: 0.25rem;
        margin-right: 1rem;
        width: 1.25rem;
        height: 1.25rem;
        cursor: pointer;
      }

      .term-content {
        flex: 1;
      }

      .term-label {
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        display: block;
        margin-bottom: 0.25rem;
        cursor: pointer;
      }

      .term-details {
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
        line-height: 1.4;
      }

      .term-link {
        color: var(--color-primary);
        text-decoration: underline;
        cursor: pointer;
        font-weight: var(--fw-medium);
      }

      .term-link:hover {
        color: var(--color-primary-dark);
      }

      .terms-actions {
        display: flex;
        justify-content: flex-end;
        gap: 1rem;
        margin-top: 2rem;
        border-top: 1px solid var(--color-border);
        padding-top: 1rem;
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
          <app-icon name="shield-check" size="32" class="terms-icon"></app-icon>
        </div>
        <h2 class="terms-title">Términos y Condiciones</h2>
        <p class="terms-description">
          Para continuar, por favor revisa y acepta los siguientes documentos
          legales.
        </p>
      </div>

      <div *ngIf="loading" class="loading-state">
        <app-icon name="loader-2" [spin]="true" size="32"></app-icon>
        <p class="mt-2 text-sm text-gray-500">Cargando documentos...</p>
      </div>

      <div *ngIf="!loading && documents.length === 0" class="empty-state">
        <p>No hay documentos pendientes por aceptar.</p>
        <app-button variant="primary" (clicked)="onComplete()"
          >Continuar</app-button
        >
      </div>

      <div *ngIf="!loading && documents.length > 0" class="terms-list">
        <div *ngFor="let doc of documents" class="term-item">
          <input
            type="checkbox"
            [id]="'doc-' + doc.id"
            [(ngModel)]="doc.accepted"
            class="term-checkbox"
            [disabled]="doc.loading"
          />
          <div class="term-content">
            <label [for]="'doc-' + doc.id" class="term-label">
              Acepto los {{ doc.title }}
            </label>
            <div class="term-details">
              Versión {{ doc.version }} •
              <a
                *ngIf="doc.content_url"
                [href]="doc.content_url"
                target="_blank"
                class="term-link"
              >
                Leer documento completo
                <app-icon
                  name="external-link"
                  size="12"
                  class="inline ml-1"
                ></app-icon>
              </a>
              <span *ngIf="!doc.content_url" class="text-gray-400"
                >(Documento no disponible)</span
              >
            </div>
          </div>
          <app-icon
            *ngIf="doc.loading"
            name="loader-2"
            [spin]="true"
            size="16"
            class="text-primary ml-2"
          ></app-icon>
        </div>
      </div>

      <div class="terms-actions" *ngIf="!loading && documents.length > 0">
        <app-button variant="outline" (clicked)="onBack()"> Atrás </app-button>
        <app-button
          variant="primary"
          [disabled]="!allAccepted || submitting"
          (clicked)="submitAcceptances()"
        >
          <span *ngIf="!submitting">Aceptar y Continuar</span>
          <span *ngIf="submitting">Procesando...</span>
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
  private cdr = inject(ChangeDetectorRef);

  loading = true;
  submitting = false;
  documents: DocumentStatus[] = [];

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

  submitAcceptances() {
    if (!this.allAccepted) return;

    this.submitting = true;
    this.cdr.markForCheck();

    // Process acceptances sequentially or in parallel
    // Since we need all of them accepted, we'll try to accept all pending ones
    const pendingDocs = this.documents.filter((d) => !d.loading); // filter out already processing if any logic added later

    // For simplicity, we'll accept them one by one and track progress
    // Or we could use forkJoin if we want parallel
    // Let's do a simple Promise.all approach with observables converted to promises for clarity
    // effectively parallel requests

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
