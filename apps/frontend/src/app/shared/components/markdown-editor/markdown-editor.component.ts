import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <!-- Toolbar -->
    <div class="flex items-center gap-1 p-2 border border-border rounded-t-lg bg-gray-50/50 flex-wrap">
      <button type="button" class="toolbar-btn" title="Negrita" (click)="insertMarkdown('bold')">
        <app-icon name="bold" size="16"></app-icon>
      </button>
      <button type="button" class="toolbar-btn" title="Cursiva" (click)="insertMarkdown('italic')">
        <app-icon name="italic" size="16"></app-icon>
      </button>
      <div class="w-px h-5 bg-border mx-1"></div>
      <button type="button" class="toolbar-btn" title="Encabezado 2" (click)="insertMarkdown('h2')">
        <span class="text-xs font-bold">H2</span>
      </button>
      <button type="button" class="toolbar-btn" title="Encabezado 3" (click)="insertMarkdown('h3')">
        <span class="text-xs font-bold">H3</span>
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
    <div class="border border-t-0 border-border rounded-b-lg overflow-hidden" [class.grid]="showPreview()" [class.grid-cols-2]="showPreview()">
      <!-- Textarea -->
      <div [class.border-r]="showPreview()" [class.border-border]="showPreview()">
        <textarea
          #editorTextarea
          class="w-full min-h-[300px] p-4 text-sm font-mono text-text-primary bg-surface resize-y focus:outline-none"
          [ngModel]="content"
          (ngModelChange)="onContentChange($event)"
          placeholder="Escribe el contenido en Markdown..."
        ></textarea>
      </div>

      <!-- Preview -->
      <div
        *ngIf="showPreview()"
        class="p-4 min-h-[300px] bg-gray-50/30 overflow-auto prose prose-sm max-w-none markdown-preview"
        [innerHTML]="previewHtml()"
      ></div>
    </div>

    <!-- Uploading indicator -->
    <div *ngIf="uploading()" class="flex items-center gap-2 mt-2 text-xs text-text-secondary">
      <div class="animate-spin rounded-full h-3 w-3 border-b-2 border-primary"></div>
      Subiendo imagen...
    </div>

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
      @apply p-1.5 rounded-md text-text-secondary hover:bg-gray-200 hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center;
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
    }
  `],
})
export class MarkdownEditorComponent {
  @Input() content = '';
  @Input() uploadFn?: (file: File) => Observable<UploadResult>;

  @Output() contentChange = new EventEmitter<string>();

  @ViewChild('editorTextarea') textareaRef!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('imageInput') imageInputRef!: ElementRef<HTMLInputElement>;

  showPreview = signal(false);
  uploading = signal(false);

  constructor(private sanitizer: DomSanitizer) {}

  previewHtml = computed((): SafeHtml => {
    return this.sanitizer.bypassSecurityTrustHtml(markdownToHtml(this.content));
  });

  onContentChange(value: string): void {
    this.content = value;
    this.contentChange.emit(value);
  }

  insertMarkdown(type: string): void {
    const textarea = this.textareaRef?.nativeElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = this.content.substring(start, end);

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
    }

    const newContent =
      this.content.substring(0, start) +
      insertion +
      this.content.substring(end);

    this.content = newContent;
    this.contentChange.emit(newContent);

    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      const newPos = start + cursorOffset;
      textarea.setSelectionRange(newPos, newPos);
    });
  }

  triggerImageUpload(): void {
    if (this.imageInputRef) {
      this.imageInputRef.nativeElement.click();
    }
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0] || !this.uploadFn) return;

    const file = input.files[0];
    this.uploading.set(true);

    this.uploadFn(file).subscribe({
      next: (result) => {
        this.insertImageAtCursor(result.url);
        this.uploading.set(false);
        input.value = '';
      },
      error: (err) => {
        console.error('Error uploading image:', err);
        this.uploading.set(false);
        input.value = '';
      },
    });
  }

  private insertImageAtCursor(url: string): void {
    const textarea = this.textareaRef?.nativeElement;
    if (!textarea) return;

    const pos = textarea.selectionStart;
    const imageMarkdown = `![image](${url})`;

    const newContent =
      this.content.substring(0, pos) +
      imageMarkdown +
      this.content.substring(pos);

    this.content = newContent;
    this.contentChange.emit(newContent);

    setTimeout(() => {
      textarea.focus();
      const newPos = pos + imageMarkdown.length;
      textarea.setSelectionRange(newPos, newPos);
    });
  }
}
