import { Component, input, output, signal, inject } from '@angular/core';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  FileUploadDropzoneComponent,
} from '../../../../../../shared/components/index';
import { CreateNotificationSoundPayload } from '../../interfaces/notification-sound.interface';

const MAX_FILE_SIZE_BYTES = 300 * 1024; // 300 KB
const ALLOWED_MIME = 'audio/mpeg';

@Component({
  selector: 'app-create-notification-sound-modal',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    FileUploadDropzoneComponent,
  ],
  templateUrl: './create-notification-sound-modal.component.html',
})
export class CreateNotificationSoundModalComponent {
  private readonly fb = inject(FormBuilder);

  readonly isOpen = input(false);
  readonly isSubmitting = input(false);

  readonly isOpenChange = output<boolean>();
  readonly submit = output<CreateNotificationSoundPayload>();

  readonly selectedFile = signal<File | null>(null);
  readonly fileError = signal<string | null>(null);

  readonly form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    sort_order: [0, [Validators.min(0)]],
  });

  onFileSelected(file: File): void {
    if (!file) {
      this.selectedFile.set(null);
      this.fileError.set(null);
      return;
    }

    if (file.type !== ALLOWED_MIME) {
      this.fileError.set('El archivo debe ser audio/mpeg (.mp3).');
      this.selectedFile.set(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      this.fileError.set('El archivo supera el tamaño máximo de 300 KB.');
      this.selectedFile.set(null);
      return;
    }

    this.fileError.set(null);
    this.selectedFile.set(file);
  }

  onFileRemoved(): void {
    this.selectedFile.set(null);
    this.fileError.set(null);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      Object.keys(this.form.controls).forEach((key) => {
        this.form.get(key)?.markAsTouched();
      });
      return;
    }

    const file = this.selectedFile();
    if (!file) {
      this.fileError.set('Selecciona un archivo de audio.');
      return;
    }

    const { name, sort_order } = this.form.value;
    this.submit.emit({
      name: name?.trim(),
      sort_order: sort_order ?? 0,
      file,
    });
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  resetForm(): void {
    this.form.reset({ name: '', sort_order: 0 });
    this.selectedFile.set(null);
    this.fileError.set(null);
  }
}
