import { Component, EventEmitter, Input, Output, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  IconComponent,
} from '../../../../../../../shared/components';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CreateTicketRequest, TicketPriority } from '../../models/ticket.model';

@Component({
  selector: 'app-create-ticket-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [title]="'Crear Nuevo Ticket'"
      subtitle="Describe tu problema y te ayudaremos lo antes posible"
    >
      <form [formGroup]="form" class="space-y-6">
        <!-- Title -->
        <app-input
          formControlName="title"
          label="Asunto *"
          placeholder="Describe brevemente tu problema..."
          [required]="true"
          [error]="getFieldError('title')"
          (blur)="onFieldBlur('title')"
          customLabelClass="mb-3"
        ></app-input>

        <!-- Category -->
        <app-selector
          formControlName="category"
          label="¿Qué tipo de problema tienes?"
          placeholder="Selecciona una categoría"
          [options]="categoryOptions"
          customLabelClass="mb-3"
        ></app-selector>

        <!-- Priority -->
        <app-selector
          formControlName="priority"
          label="¿Qué tan urgente es?"
          placeholder="Selecciona la prioridad"
          [options]="priorityOptions"
          customLabelClass="mb-3"
        ></app-selector>

        <!-- Description -->
        <app-textarea
          formControlName="description"
          label="Describe el problema *"
          placeholder="Cuéntanos más detalles sobre lo que está pasando..."
          [required]="true"
          [error]="getFieldError('description')"
          (blur)="onFieldBlur('description')"
          [rows]="6"
          customLabelClass="mb-3"
        ></app-textarea>

        <!-- Attachments -->
        <div>
          <label class="block text-sm font-semibold text-text-primary mb-2">
            Imagen (opcional)
          </label>
          <p class="text-xs text-text-secondary mb-3">
            Puedes adjuntar una captura de pantalla para ayudarnos a entender mejor el problema.
          </p>

          <!-- Upload area - only show if no image selected -->
          @if (selectedImages.length === 0) {
            <div
              class="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary hover:bg-primary/5 transition-all cursor-pointer"
              (dragover)="onDragOver($event)"
              (dragleave)="onDragLeave($event)"
              (drop)="onDrop($event)"
              (click)="triggerFileSelect()"
              [class.border-primary]="isDragging"
              [class.bg-primary\/5]="isDragging"
            >
              <input
                type="file"
                accept="image/*"
                (change)="onFileSelected($event)"
                class="hidden"
                #fileInput
              >
              <div class="flex flex-col items-center justify-center">
                <app-icon name="upload-cloud" [size]="32" class="text-gray-400 mb-2" [class.text-primary]="isDragging"></app-icon>
                <p class="text-sm font-medium text-gray-700">
                  Arrastra una imagen aquí
                </p>
                <p class="text-xs text-gray-500 mt-1">
                  o haz clic para seleccionar
                </p>
              </div>
            </div>
          }

          <!-- Preview of selected image -->
          @if (selectedImages.length > 0) {
            <div class="mt-3">
              <div class="relative group inline-block">
                <img [src]="selectedImages[0].preview" class="w-32 h-32 object-cover rounded-lg border border-border">
                <button
                  type="button"
                  (click)="removeImage(0)"
                  class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            </div>
          }
        </div>
      </form>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button
          variant="primary"
          [disabled]="form.invalid || loading"
          [loading]="loading"
          (clicked)="onSubmit()"
        >
          Crear Ticket
        </app-button>
      </div>
    </app-modal>
  `
})
export class CreateTicketModalComponent {
  @Input() isOpen = false;
  @Input() loading = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();
  @Output() save = new EventEmitter<CreateTicketRequest & { attachments?: Array<any> }>();

  form: FormGroup;

  categoryOptions = [
    { value: 'QUESTION', label: 'Duda' },
    { value: 'SERVICE_REQUEST', label: 'Solicitud' },
    { value: 'INCIDENT', label: 'Incidente' },
    { value: 'PROBLEM', label: 'Problema' },
    { value: 'CHANGE', label: 'Cambio' },
  ];

  priorityOptions = [
    { value: 'P4', label: 'P4 - Baja' },
    { value: 'P3', label: 'P3 - Normal' },
    { value: 'P2', label: 'P2 - Alta' },
    { value: 'P1', label: 'P1 - Urgente' },
    { value: 'P0', label: 'P0 - Crítica' },
  ];

  selectedImages: Array<{ file: File; preview: string; base64: string }> = [];
  isDragging = false;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
      category: ['QUESTION'],
      priority: ['P3'],
    });
  }

  onCancel() {
    this.closed.emit();
    this.isOpenChange.emit(false);
    this.form.reset();
    this.selectedImages = [];
  }

  onSubmit() {
    if (this.form.valid) {
      const value = this.form.value;
      const request: CreateTicketRequest & { attachments?: Array<any> } = {
        title: value.title,
        description: value.description,
        category: value.category || undefined,
        priority: value.priority as TicketPriority,
      };

      if (this.selectedImages.length > 0) {
        request.attachments = this.selectedImages.map(img => ({
          base64_data: img.base64,
          file_name: img.file.name,
          mime_type: img.file.type,
        }));
      }

      this.save.emit(request);
    } else {
      this.form.markAllAsTouched();
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = (e.target as FileReader).result as string;
          // Replace any existing image with the new one
          this.selectedImages = [{
            file,
            preview: base64,
            base64: base64.split(',')[1], // Remove data:image/...;base64, prefix
          }];
        };
        reader.readAsDataURL(file);
      }
    }
    // Clear input value to allow selecting the same file again
    input.value = '';
  }

  removeImage(index: number) {
    this.selectedImages.splice(index, 1);
  }

  triggerFileSelect() {
    if (this.fileInput) {
      this.fileInput.nativeElement.click();
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = (e.target as FileReader).result as string;
          this.selectedImages = [{
            file,
            preview: base64,
            base64: base64.split(',')[1],
          }];
        };
        reader.readAsDataURL(file);
      }
    }
  }

  getFieldError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['minlength']) return `Mínimo ${control.errors['minlength'].requiredLength} caracteres`;
      if (control.errors['maxlength']) return `Máximo ${control.errors['maxlength'].requiredLength} caracteres`;
    }
    return '';
  }

  onFieldBlur(field: string) {
    this.form.get(field)?.markAsTouched();
  }
}
