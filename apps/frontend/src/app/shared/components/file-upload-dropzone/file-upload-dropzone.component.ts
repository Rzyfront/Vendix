import {
  Component,
  ViewChild,
  ElementRef,
  signal,
  input,
  output,
} from '@angular/core';

import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-file-upload-dropzone',
  standalone: true,
  imports: [IconComponent],
  template: `
    <!-- State: file selected -->
    @if (selectedFile()) {
      <div class="relative border-2 border-gray-200 rounded-xl bg-gray-50/50 p-4">
        <!-- Remove button -->
        <button
          type="button"
          class="absolute top-2 right-2 p-1 rounded-full bg-white shadow-sm border border-gray-200 hover:bg-red-50 hover:border-red-300 transition-colors"
          (click)="removeFile()"
          [disabled]="disabled()"
          >
          <app-icon name="x" size="14" class="text-gray-500 hover:text-red-500"></app-icon>
        </button>
        <!-- Image preview -->
        @if (previewUrl()) {
          <div class="flex flex-col items-center gap-2">
            <img
              [src]="previewUrl()"
              alt="Preview"
              class="max-h-32 rounded-lg border border-border object-contain"
              />
            <button
              type="button"
              class="text-xs text-primary-600 hover:text-primary-700 hover:underline font-medium"
              (click)="triggerFileInput()"
              [disabled]="disabled()"
              >
              Cambiar archivo
            </button>
          </div>
        }
        <!-- Non-image file display -->
        @if (!previewUrl()) {
          <div class="flex items-center gap-3">
            <div class="p-2 bg-white rounded-lg shadow-sm border border-gray-100">
              <app-icon name="file-text" size="24" class="text-primary-500"></app-icon>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-700 truncate">{{ selectedFile()!.name }}</p>
              <button
                type="button"
                class="text-xs text-primary-600 hover:text-primary-700 hover:underline font-medium"
                (click)="triggerFileInput()"
                [disabled]="disabled()"
                >
                Cambiar archivo
              </button>
            </div>
          </div>
        }
      </div>
    } @else {
      <div
        (click)="triggerFileInput()"
        class="group w-full py-4 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50 flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-white hover:border-primary-300 hover:shadow-md"
        [class.opacity-50]="disabled()"
        [class.pointer-events-none]="disabled()"
        >
        <div class="p-2 bg-white rounded-full shadow-sm mb-2 group-hover:scale-110 transition-transform">
          <app-icon [name]="icon()" size="24" class="text-primary-500"></app-icon>
        </div>
        <p class="text-[13px] font-semibold text-gray-700">{{ label() }}</p>
        @if (helperText()) {
          <p class="text-xs text-gray-500 mt-0.5">{{ helperText() }}</p>
        }
      </div>
    }
    
    <!-- State: empty dropzone -->
    
    <!-- Hidden file input -->
    <input
      #fileInput
      type="file"
      class="hidden"
      [accept]="accept()"
      (change)="onInputChange($event)"
      />
    `,
})
export class FileUploadDropzoneComponent {
  readonly label = input<string>('Subir archivo');
  readonly helperText = input<string>('');
  readonly accept = input<string>('*');
  readonly icon = input<string>('upload-cloud');
  readonly disabled = input<boolean>(false);

  readonly fileSelected = output<File>();
  readonly fileRemoved = output<void>();

  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  readonly selectedFile = signal<File | null>(null);
  readonly previewUrl = signal<string | null>(null);

  triggerFileInput(): void {
    if (!this.disabled()) {
      this.fileInputRef.nativeElement.click();
    }
  }

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.selectedFile.set(file);

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          this.previewUrl.set(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        this.previewUrl.set(null);
      }

      this.fileSelected.emit(file);
    }
  }

  removeFile(): void {
    this.selectedFile.set(null);
    this.previewUrl.set(null);
    this.fileInputRef.nativeElement.value = '';
    this.fileRemoved.emit();
  }

  /** Public method for programmatic reset from parent */
  clear(): void {
    this.removeFile();
  }
}
