import {
  Component,
  ElementRef,
  signal,
  computed,
  input,
  model,
  output,
  viewChild
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Observable } from 'rxjs';
import { IconComponent } from '../icon/icon.component';
import { markdownToHtml } from '../../utils/markdown.util';

interface UploadResult {
  key: string;
  url: string;
}

@Component({
  selector: 'app-markdown-editor',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <!-- Toolbar -->
    <div class="flex items-center gap-1 p-2 border border-border rounded-t-lg bg-gray-100/80 flex-wrap">
      <button type="button" class="toolbar-btn" title="Negrita" (click)="insertMarkdown('bold')">
        <app-icon name="bold" size="16"></app-icon>
      </button>
      <button type="button" class="toolbar-btn" title="Cursiva" (click)="insertMarkdown('italic')">
        <app-icon name="italic" size="16"></app-icon>
      </button>
      <div class="w-px h-5 bg-border mx-1"></div>
      <button type="button" class="toolbar-btn" title="Encabezado 2" (click)="insertMarkdown('h2')">
        <app-icon name="heading-2" size="16"></app-icon>
      </button>
      <button type="button" class="toolbar-btn" title="Encabezado 3" (click)="insertMarkdown('h3')">
        <app-icon name="heading-3" size="16"></app-icon>
      </button>
      <div class="w-px h-5 bg-border mx-1"></div>
      <button type="button" class="toolbar-btn" title="Lista" (click)="insertMarkdown('ul')">
        <app-icon name="list" size="16"></app-icon>
      </button>
      <button type="button" class="toolbar-btn" title="Lista numerada" (click)="insertMarkdown('ol')">
        <app-icon name="list-ordered" size="16"></app-icon>
      </button>
      <div class="w-px h-5 bg-border mx-1"></div>
      <button type="button" class="toolbar-btn" title="Enlace" (click)="insertMarkdown('link')">
        <app-icon name="link" size="16"></app-icon>
      </button>
      <button
        type="button"
        class="toolbar-btn"
        title="Imagen"
        (click)="triggerImageUpload()"
        [disabled]="uploading()"
        >
        <app-icon name="image" size="16"></app-icon>
      </button>
      <div class="w-px h-5 bg-border mx-1"></div>
      <button type="button" class="toolbar-btn" title="Código" (click)="insertMarkdown('code')">
        <app-icon name="code" size="16"></app-icon>
      </button>
      <button type="button" class="toolbar-btn" title="Cita" (click)="insertMarkdown('quote')">
        <app-icon name="text-quote" size="16"></app-icon>
      </button>
    
      <!-- Spacer -->
      <div class="flex-1"></div>
    
      <!-- Preview toggle -->
      <button
        type="button"
        class="toolbar-btn px-2"
        [class.bg-primary-100]="showPreview()"
        [class.text-primary-700]="showPreview()"
        (click)="showPreview.set(!showPreview())"
        >
        <app-icon name="eye" size="16"></app-icon>
        <span class="text-xs ml-1 hidden sm:inline">Vista previa</span>
      </button>
    </div>
    
    <!-- Editor Body -->
    <div
      class="relative border border-t-0 border-border rounded-b-lg overflow-hidden transition-colors"
      [class.grid]="showPreview()"
      [class.grid-cols-2]="showPreview()"
      [class.border-primary-300]="dragging()"
      [class.bg-primary-50]="dragging()"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
      >
      <!-- Drag overlay -->
      @if (dragging()) {
        <div
          class="absolute inset-0 z-10 flex items-center justify-center bg-primary-50/80 backdrop-blur-sm rounded-b-lg pointer-events-none"
          >
          <div class="flex flex-col items-center gap-2 text-primary-600">
            <app-icon name="image-plus" size="32"></app-icon>
            <span class="text-sm font-medium">Suelta la imagen aquí</span>
          </div>
        </div>
      }
    
      <!-- Textarea -->
      <div [class.border-r]="showPreview()" [class.border-border]="showPreview()">
        <textarea
          #editorTextarea
          class="w-full min-h-[300px] p-4 text-sm font-mono text-text-primary bg-surface resize-y focus:outline-none"
          [ngModel]="content()"
          (ngModelChange)="onContentChange($event)"
          (paste)="onPaste($event)"
          placeholder="Escribe el contenido en Markdown..."
        ></textarea>
      </div>
    
      <!-- Preview -->
      @if (showPreview()) {
        <div
          class="p-4 min-h-[300px] bg-gray-50/30 overflow-auto prose prose-sm max-w-none markdown-preview"
          [innerHTML]="previewHtml()"
        ></div>
      }
    </div>
    
    <!-- Uploading indicator -->
    @if (uploading()) {
      <div class="flex items-center gap-2 mt-2 text-xs text-text-secondary">
        <div class="animate-spin rounded-full h-3 w-3 border-b-2 border-primary"></div>
        Subiendo: {{ uploadingFileName() }}...
      </div>
    }
    
    <!-- Hidden file input -->
    <input
      #imageInput
      type="file"
      class="hidden"
      accept="image/*"
      (change)="onImageSelected($event)"
      />
    `,
  styles: [`
    :host {
      display: block;
    }

    .toolbar-btn {
      @apply p-1.5 rounded-md text-gray-600 hover:bg-gray-200/80 hover:text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center;
    }

    :host ::ng-deep .markdown-preview {
      h2 { @apply text-lg font-semibold mt-4 mb-2; }
      h3 { @apply text-base font-semibold mt-3 mb-1; }
      p { @apply mb-2 leading-relaxed; }
      ul { @apply list-disc pl-5 mb-3; }
      ol { @apply list-decimal pl-5 mb-3; }
      li { @apply mb-1; }
      img { @apply max-w-full rounded-lg my-2; }
      a { @apply text-primary-600 hover:underline; }
      strong { @apply font-semibold; }
      em { @apply italic; }
      br { @apply block mb-2; }
      code { @apply bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono; }
      blockquote { @apply border-l-4 border-gray-300 pl-4 italic text-gray-600 my-2; }
    }
  `],
})
export class MarkdownEditorComponent {
  readonly content = model<string>('');
  readonly uploadFn = input<(file: File) => Observable<UploadResult>>();

  readonly uploadError = output<string>();

  readonly textareaRef = viewChild.required<ElementRef<HTMLTextAreaElement>>('editorTextarea');
  readonly imageInputRef = viewChild.required<ElementRef<HTMLInputElement>>('imageInput');

  showPreview = signal(false);
  uploading = signal(false);
  uploadingFileName = signal('');
  dragging = signal(false);

  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly ALLOWED_TYPES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'image/bmp', 'image/tiff', 'image/svg+xml',
    'image/heic', 'image/heif', 'image/avif',
  ];

  constructor(private sanitizer: DomSanitizer) {}

  previewHtml = computed((): SafeHtml => {
    return this.sanitizer.bypassSecurityTrustHtml(markdownToHtml(this.content()));
  });

  onContentChange(value: string): void {
    this.content.set(value);
  }

  insertMarkdown(type: string): void {
    const textarea = this.textareaRef()?.nativeElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = this.content();
    const selected = current.substring(start, end);

    let insertion = '';
    let cursorOffset = 0;

    switch (type) {
      case 'bold':
        insertion = `**${selected || 'texto'}**`;
        cursorOffset = selected ? insertion.length : 2;
        break;
      case 'italic':
        insertion = `*${selected || 'texto'}*`;
        cursorOffset = selected ? insertion.length : 1;
        break;
      case 'h2':
        insertion = `## ${selected || 'Encabezado'}`;
        cursorOffset = insertion.length;
        break;
      case 'h3':
        insertion = `### ${selected || 'Encabezado'}`;
        cursorOffset = insertion.length;
        break;
      case 'ul':
        insertion = `- ${selected || 'Elemento'}`;
        cursorOffset = insertion.length;
        break;
      case 'ol':
        insertion = `1. ${selected || 'Elemento'}`;
        cursorOffset = insertion.length;
        break;
      case 'link':
        insertion = `[${selected || 'texto'}](url)`;
        cursorOffset = selected ? insertion.length - 1 : 1;
        break;
      case 'code':
        insertion = `\`${selected || 'código'}\``;
        cursorOffset = selected ? insertion.length : 1;
        break;
      case 'quote':
        insertion = `> ${selected || 'cita'}`;
        cursorOffset = insertion.length;
        break;
    }

    const newContent =
      current.substring(0, start) +
      insertion +
      current.substring(end);

    this.content.set(newContent);

    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      const newPos = start + cursorOffset;
      textarea.setSelectionRange(newPos, newPos);
    });
  }

  triggerImageUpload(): void {
    const imageInputRef = this.imageInputRef();
    if (imageInputRef) {
      imageInputRef.nativeElement.click();
    }
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    this.processImageUpload(input.files[0]);
    input.value = '';
  }

  private processImageUpload(file: File): void {
    const uploadFn = this.uploadFn();
    if (!uploadFn) {
      this.uploadError.emit('No se configuró la función de carga de imágenes.');
      return;
    }

    const error = this.validateImageFile(file);
    if (error) {
      this.uploadError.emit(error);
      return;
    }

    this.uploading.set(true);
    this.uploadingFileName.set(file.name);

    uploadFn(file).subscribe({
      next: (result) => {
        this.insertImageAtCursor(result.url);
        this.uploading.set(false);
        this.uploadingFileName.set('');
      },
      error: (err) => {
        console.error('Error uploading image:', err);
        this.uploadError.emit('Error al subir la imagen. Intenta de nuevo.');
        this.uploading.set(false);
        this.uploadingFileName.set('');
      },
    });
  }

  private validateImageFile(file: File): string | null {
    if (!this.ALLOWED_TYPES.includes(file.type)) {
      return `Formato no soportado: ${file.type.split('/')[1] || 'desconocido'}. Usa JPG, PNG, WebP, GIF, BMP, TIFF, SVG, HEIC o AVIF.`;
    }
    if (file.size > this.MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return `La imagen pesa ${sizeMB}MB. El máximo permitido es 10MB.`;
    }
    return null;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        this.processImageUpload(file);
      }
    }
  }

  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        event.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          this.processImageUpload(file);
        }
        break;
      }
    }
  }

  private insertImageAtCursor(url: string): void {
    const textarea = this.textareaRef()?.nativeElement;
    if (!textarea) return;

    const pos = textarea.selectionStart;
    const imageMarkdown = `![image](${url})`;

    const current = this.content();
    const newContent =
      current.substring(0, pos) +
      imageMarkdown +
      current.substring(pos);

    this.content.set(newContent);

    setTimeout(() => {
      textarea.focus();
      const newPos = pos + imageMarkdown.length;
      textarea.setSelectionRange(newPos, newPos);
    });
  }
}
