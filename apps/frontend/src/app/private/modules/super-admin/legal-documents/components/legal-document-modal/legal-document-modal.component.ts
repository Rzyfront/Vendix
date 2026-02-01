import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  OnChanges,
  SimpleChanges,
  Output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  FormControl,
} from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  LegalDocumentTypeEnum,
  CreateSystemDocumentDto,
  UpdateSystemDocumentDto,
  LegalDocument,
} from '../../interfaces/legal-document.interface';

@Component({
  selector: 'app-legal-document-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      [title]="isEditMode ? 'Editar Documento Legal' : 'Nuevo Documento Legal'"
      [subtitle]="
        isEditMode
          ? 'Actualiza los metadatos del documento legal.'
          : 'Crea una nueva versión de documento legal para el sistema.'
      "
      (cancel)="onClose()"
      size="lg"
    >
      <!-- Modal Body -->
      <div class="p-4 md:p-6 space-y-6">
        <form [formGroup]="form" class="space-y-6">
          <!-- Information Alert (Optional but pretty) -->
          <div
            *ngIf="isEditMode"
            class="bg-blue-50 border border-blue-100 rounded-lg p-3 flex gap-3 items-start"
          >
            <div class="mt-0.5 text-blue-500">
              <app-icon name="info" size="18"></app-icon>
            </div>
            <div class="text-xs text-blue-700 leading-relaxed">
              <strong>Modo Edición Limitado:</strong> El contenido y la versión
              de un documento legal son inmutables por seguridad. Para cambiar
              el texto, debes crear una nueva versión.
            </div>
          </div>

          <!-- Section 1: Identity & Version -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <app-selector
              label="Tipo de Documento"
              [formControl]="documentTypeControl"
              [options]="documentTypeOptions"
              [required]="true"
              placeholder="Seleccionar tipo..."
              tooltipText="Clasificación legal del documento dentro del sistema"
            ></app-selector>

            <app-input
              label="Versión"
              [formControl]="versionControl"
              placeholder="Ej. 1.0.0"
              [required]="true"
              [prefixIcon]="true"
              tooltipText="Identificador único de versión. Se recomienda usar Versionado Semántico (SemVer)"
            >
              <app-icon
                slot="prefix-icon"
                name="hash"
                size="16"
                class="text-gray-400"
              ></app-icon>
            </app-input>
          </div>

          <!-- Section 2: Title (Full Width) -->
          <app-input
            label="Título del Documento"
            [formControl]="titleControl"
            placeholder="Ej. Términos y Condiciones Generales de Uso"
            [required]="true"
            [prefixIcon]="true"
          >
            <app-icon
              slot="prefix-icon"
              name="file-text"
              size="16"
              class="text-gray-400"
            ></app-icon>
          </app-input>

          <!-- Section 3: Dates -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <app-input
              label="Fecha de Efectividad"
              type="date"
              [formControl]="effectiveDateControl"
              [required]="true"
              [prefixIcon]="true"
              tooltipText="Fecha a partir de la cual el documento tiene validez legal"
            >
              <app-icon
                slot="prefix-icon"
                name="calendar"
                size="16"
                class="text-gray-400"
              ></app-icon>
            </app-input>

            <app-input
              label="Fecha de Expiración"
              type="date"
              [formControl]="expiryDateControl"
              [prefixIcon]="true"
              tooltipText="Opcional. Fecha en la que el documento deja de ser válido"
            >
              <app-icon
                slot="prefix-icon"
                name="clock"
                size="16"
                class="text-gray-400"
              ></app-icon>
            </app-input>
          </div>

          <!-- Section 4: Content (Source of Truth) -->
          <div class="space-y-2">
            <label
              class="text-sm font-medium text-text-primary flex items-center gap-2"
            >
              <app-icon name="code" size="16" class="text-gray-500"></app-icon>
              Contenido (Formato Markdown)
              <span class="text-destructive">*</span>
            </label>
            <app-textarea
              [formControl]="contentControl"
              [required]="true"
              [rows]="12"
              placeholder="Escribe el cuerpo legal utilizando sintaxis Markdown..."
              [customClass]="
                (isEditMode
                  ? 'bg-gray-50 cursor-not-allowed text-gray-500 '
                  : '') + 'font-mono text-sm'
              "
            ></app-textarea>

            <p
              class="text-[10px] text-text-secondary flex items-center gap-1.5 px-1"
            >
              <app-icon name="external-link" size="12"></app-icon>
              El contenido se guardará como un archivo .md en el storage de
              assets.
            </p>
          </div>

          <!-- Section 5: Internal Metadata -->
          <app-textarea
            label="Notas Internas / Descripción"
            [formControl]="descriptionControl"
            [rows]="3"
            placeholder="Agrega contexto interno sobre esta versión (no visible para el cliente)..."
          ></app-textarea>
        </form>
      </div>

      <!-- Modal Footer -->
      <div slot="footer" class="w-full">
        <div
          class="flex items-center justify-end gap-3 p-4 bg-gray-50 rounded-b-xl border-t border-gray-100"
        >
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="form.invalid || isSubmitting"
            [loading]="isSubmitting"
          >
            <app-icon
              slot="icon"
              [name]="isEditMode ? 'save' : 'plus'"
              size="16"
            ></app-icon>
            {{ isEditMode ? 'Guardar Cambios' : 'Publicar Documento' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class LegalDocumentModalComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() document?: LegalDocument;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() save = new EventEmitter<
    CreateSystemDocumentDto | UpdateSystemDocumentDto
  >();
  @Output() cancel = new EventEmitter<void>();

  private fb = inject(FormBuilder);

  form: FormGroup;
  isSubmitting = false;

  documentTypeOptions: SelectorOption[] = Object.values(
    LegalDocumentTypeEnum,
  ).map((type) => ({
    label: this.formatEnumLabel(type),
    value: type,
  }));

  constructor() {
    this.form = this.fb.group({
      document_type: [null, Validators.required],
      title: ['', Validators.required],
      version: ['', Validators.required],
      effective_date: ['', Validators.required],
      expiry_date: [null],
      content: ['', Validators.required],
      description: [''],
    });
  }

  get isEditMode(): boolean {
    return !!this.document;
  }

  // Typed getters for form controls
  get documentTypeControl(): FormControl {
    return this.form.get('document_type') as FormControl;
  }

  get titleControl(): FormControl {
    return this.form.get('title') as FormControl;
  }

  get versionControl(): FormControl {
    return this.form.get('version') as FormControl;
  }

  get effectiveDateControl(): FormControl {
    return this.form.get('effective_date') as FormControl;
  }

  get expiryDateControl(): FormControl {
    return this.form.get('expiry_date') as FormControl;
  }

  get contentControl(): FormControl {
    return this.form.get('content') as FormControl;
  }

  get descriptionControl(): FormControl {
    return this.form.get('description') as FormControl;
  }

  ngOnInit() {
    this.updateFormState();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['document']) {
      this.updateFormState();
    }

    if (changes['isOpen'] && changes['isOpen'].currentValue === false) {
      this.resetForm();
    }
  }

  private updateFormState() {
    if (this.document) {
      this.patchForm(this.document);
      this.versionControl.disable();
      this.contentControl.disable();
      this.documentTypeControl.disable();
    } else {
      this.resetForm();
      this.versionControl.enable();
      this.contentControl.enable();
      this.documentTypeControl.enable();
    }
  }

  private resetForm() {
    this.form.reset();
    this.isSubmitting = false;
  }

  patchForm(doc: LegalDocument) {
    this.form.patchValue({
      document_type: doc.document_type,
      title: doc.title,
      version: doc.version,
      content: doc.content,
      description: doc.description,
      effective_date: this.formatDateForInput(doc.effective_date),
      expiry_date: this.formatDateForInput(doc.expiry_date),
    });
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    // Simulate API delay or just emit immediately
    // In a real app, the parent handles the API call and sets loading state back
    // For now I will emit and let parent handle it.

    const formValue = this.form.getRawValue(); // use getRawValue to include disabled fields if needed, or value if not

    // Prepare DTO
    let dto: CreateSystemDocumentDto | UpdateSystemDocumentDto;

    if (this.isEditMode) {
      dto = {
        title: formValue.title,
        description: formValue.description,
        effective_date: new Date(formValue.effective_date).toISOString(),
        expiry_date: formValue.expiry_date
          ? new Date(formValue.expiry_date).toISOString()
          : undefined,
      } as UpdateSystemDocumentDto;
    } else {
      dto = {
        document_type: formValue.document_type,
        title: formValue.title,
        version: formValue.version,
        content: formValue.content,
        description: formValue.description,
        effective_date: new Date(formValue.effective_date).toISOString(),
        expiry_date: formValue.expiry_date
          ? new Date(formValue.expiry_date).toISOString()
          : undefined,
      } as CreateSystemDocumentDto;
    }

    this.save.emit(dto);
    // Don't close immediately, wait for parent to handle success/error logic usually.
    // But since I don't control the parent here, I'll assume the parent will handle closing or I should just emit save.
  }

  onClose() {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  private formatDateForInput(dateStr?: string): string | null {
    if (!dateStr) return null;
    return new Date(dateStr).toISOString().split('T')[0];
  }

  private formatEnumLabel(type: string): string {
    return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }
}
