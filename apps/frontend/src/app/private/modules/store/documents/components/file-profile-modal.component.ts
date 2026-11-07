import { Component, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { concatMap, of } from 'rxjs';
import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../shared/components/index';
import { LibraryFile } from '../interfaces/document-library.interfaces';
import {
  DocumentsLibraryApiService,
  libraryErrorMessage,
} from '../services/documents-library-api.service';

/**
 * Edits what the person knows about a file: type, tags, "Vence el" and
 * "Retención legal". Saving emits the updated file for the parent list.
 */
@Component({
  selector: 'app-file-profile-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, InputComponent, ToggleComponent, FormsModule],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Datos del documento"
      [subtitle]="file()?.original_name ?? ''"
      size="md"
    >
      <div class="flex flex-col gap-3" data-testid="file-profile-form">
        <app-input
          label="Tipo de documento"
          placeholder="Póliza, RUT, Cédula..."
          [ngModel]="docType()"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="docType.set($event ?? '')"
        />
        <app-input
          label="Etiquetas"
          placeholder="seguro, vehículo"
          helperText="Sepáralas con comas. Hasta 20 etiquetas."
          [ngModel]="tagsText()"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="tagsText.set($event ?? '')"
        />
        <app-input
          type="date"
          label="Vence el"
          helperText="Vendix te avisa 30 días antes. Vacío: no vence."
          [ngModel]="validUntil()"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="validUntil.set($event ?? '')"
        />
        <div class="flex flex-col gap-1">
          <app-toggle
            label="Retención legal"
            [checked]="legalHold()"
            (toggled)="legalHold.set($event)"
          />
          <span class="text-xs text-text-secondary">
            Mientras esté activa, la purga por política no toca este archivo.
          </span>
        </div>
        @if (errorMessage()) {
          <p class="text-sm text-error" role="alert">{{ errorMessage() }}</p>
        }
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" [loading]="saving()" (clicked)="save()">Guardar</app-button>
      </div>
    </app-modal>
  `,
})
export class FileProfileModalComponent {
  private readonly api = inject(DocumentsLibraryApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly file = input<LibraryFile | null>(null);
  readonly saved = output<LibraryFile>();

  readonly docType = signal('');
  readonly tagsText = signal('');
  readonly validUntil = signal('');
  readonly legalHold = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal('');

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const file = this.file();
      untracked(() => {
        if (!open || !file) return;
        this.docType.set(file.doc_type ?? '');
        this.tagsText.set(file.tags.join(', '));
        this.validUntil.set(file.valid_until ?? '');
        this.legalHold.set(file.legal_hold);
        this.errorMessage.set('');
      });
    });
  }

  save(): void {
    const file = this.file();
    if (!file || this.saving()) return;
    this.saving.set(true);
    this.errorMessage.set('');
    const tags = this.tagsText()
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const holdChanged = this.legalHold() !== file.legal_hold;
    this.api
      .updateProfile(file.id, {
        doc_type: this.docType().trim() || null,
        tags,
        valid_until: this.validUntil() || null,
      })
      .pipe(
        concatMap((profile) =>
          holdChanged ? this.api.setLegalHold(file.id, this.legalHold()) : of(profile),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (profile) => {
          this.saving.set(false);
          this.toast.success('Datos del documento guardados');
          this.saved.emit({
            ...file,
            doc_type: profile.doc_type,
            tags: profile.tags,
            valid_until: profile.valid_until,
            legal_hold: profile.legal_hold,
          });
          this.isOpen.set(false);
        },
        error: (error) => {
          this.saving.set(false);
          this.errorMessage.set(libraryErrorMessage(error));
        },
      });
  }
}
