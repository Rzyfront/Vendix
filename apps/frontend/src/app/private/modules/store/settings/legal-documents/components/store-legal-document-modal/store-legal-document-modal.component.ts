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
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../../shared/components/textarea/textarea.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import {
  StoreLegalDocument,
  CreateStoreDocumentDto,
  UpdateStoreDocumentDto,
} from '../../interfaces/store-legal-document.interface';

@Component({
  selector: 'app-store-legal-document-modal',
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
      [title]="isEditMode ? 'Editar Documento de Tienda' : 'Nuevo Documento de Tienda'"
      [subtitle]="
        isEditMode
          ? 'Actualiza los metadatos del documento legal.'
          : 'Crea una nueva versión de documento legal para tu tienda.'
      "
      (cancel)="onClose()"
      size="lg"
    >
      <div class="p-4 md:p-6 space-y-6">
        <form [formGroup]="form" class="space-y-6">
          <div
            *ngIf="isEditMode"
            class="bg-blue-50 border border-blue-100 rounded-lg p-3 flex gap-3 items-start"
          >
            <div class="mt-0.5 text-blue-500">
              <app-icon name="info" size="18"></app-icon>
            </div>
            <div class="text-xs text-blue-700 leading-relaxed">
              <strong>Modo Edición Limitado:</strong> El contenido y la versión
              de un documento legal son inmutables. Para cambiar el texto, debes crear una nueva versión.
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <app-selector
              label="Tipo de Documento"
              [formControl]="documentTypeControl"
              [options]="documentTypeOptions"
              [required]="true"
              placeholder="Seleccionar tipo..."
            ></app-selector>

            <app-input
              label="Versión"
              [formControl]="versionControl"
              placeholder="Ej. 1.0.0"
              [required]="true"
              [prefixIcon]="true"
            >
              <app-icon
                slot="prefix-icon"
                name="hash"
                size="16"
                class="text-gray-400"
              ></app-icon>
            </app-input>
          </div>

          <app-input
            label="Título del Documento"
            [formControl]="titleControl"
            placeholder="Ej. Términos y Condiciones de Mi Tienda"
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

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <app-input
              label="Fecha de Efectividad"
              type="date"
              [formControl]="effectiveDateControl"
              [required]="true"
              [prefixIcon]="true"
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
            >
              <app-icon
                slot="prefix-icon"
                name="clock"
                size="16"
                class="text-gray-400"
              ></app-icon>
            </app-input>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium text-text-primary flex items-center gap-2">
              <app-icon name="code" size="16" class="text-gray-500"></app-icon>
              Contenido (Markdown)
              <span class="text-destructive">*</span>
            </label>
            <app-textarea
              [formControl]="contentControl"
              [required]="true"
              [rows]="12"
              placeholder="Escribe el cuerpo legal utilizando Markdown..."
              [customClass]="(isEditMode ? 'bg-gray-50 cursor-not-allowed text-gray-500 ' : '') + 'font-mono text-sm'"
            ></app-textarea>
          </div>

          <app-textarea
            label="Descripción Interna"
            [formControl]="descriptionControl"
            [rows]="3"
            placeholder="Contexto interno sobre esta versión..."
          ></app-textarea>
        </form>
      </div>

      <div slot="footer" class="w-full">
        <div class="flex items-center justify-end gap-3 p-4 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="form.invalid || isSubmitting"
            [loading]="isSubmitting"
          >
            {{ isEditMode ? 'Guardar Cambios' : 'Publicar' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class StoreLegalDocumentModalComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() document?: StoreLegalDocument;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() save = new EventEmitter<CreateStoreDocumentDto | UpdateStoreDocumentDto>();
  @Output() cancel = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  form: FormGroup;
  isSubmitting = false;

  documentTypeOptions: SelectorOption[] = [
    { label: 'Términos de Servicio', value: 'TERMS_OF_SERVICE' },
    { label: 'Política de Privacidad', value: 'PRIVACY_POLICY' },
    { label: 'Política de Reembolso', value: 'REFUND_POLICY' },
    { label: 'Política de Envío', value: 'SHIPPING_POLICY' },
    { label: 'Política de Devolución', value: 'RETURN_POLICY' },
    { label: 'Política de Cookies', value: 'COOKIES_POLICY' },
  ];

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

  get documentTypeControl(): FormControl { return this.form.get('document_type') as FormControl; }
  get titleControl(): FormControl { return this.form.get('title') as FormControl; }
  get versionControl(): FormControl { return this.form.get('version') as FormControl; }
  get effectiveDateControl(): FormControl { return this.form.get('effective_date') as FormControl; }
  get expiryDateControl(): FormControl { return this.form.get('expiry_date') as FormControl; }
  get contentControl(): FormControl { return this.form.get('content') as FormControl; }
  get descriptionControl(): FormControl { return this.form.get('description') as FormControl; }

  ngOnInit() { this.updateFormState(); }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['document']) this.updateFormState();
    if (changes['isOpen'] && changes['isOpen'].currentValue === false) this.resetForm();
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

  patchForm(doc: StoreLegalDocument) {
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
    const formValue = this.form.getRawValue();

    let dto: CreateStoreDocumentDto | UpdateStoreDocumentDto;

    if (this.isEditMode) {
      dto = {
        title: formValue.title,
        description: formValue.description,
        effective_date: new Date(formValue.effective_date).toISOString(),
        expiry_date: formValue.expiry_date ? new Date(formValue.expiry_date).toISOString() : undefined,
      };
    } else {
      dto = {
        document_type: formValue.document_type,
        title: formValue.title,
        version: formValue.version,
        content: formValue.content,
        description: formValue.description,
        effective_date: new Date(formValue.effective_date).toISOString(),
        expiry_date: formValue.expiry_date ? new Date(formValue.expiry_date).toISOString() : undefined,
      };
    }

    this.save.emit(dto);
  }

  onClose() {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  private formatDateForInput(date?: Date | string): string | null {
    if (!date) return null;
    return new Date(date).toISOString().split('T')[0];
  }
}
