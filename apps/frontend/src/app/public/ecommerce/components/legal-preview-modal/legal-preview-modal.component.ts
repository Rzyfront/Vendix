import { Component, EventEmitter, Input, Output, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-legal-preview-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './legal-preview-modal.component.html',
  styleUrl: './legal-preview-modal.component.scss',
})
export class LegalPreviewModalComponent {
  @Input() isOpen = false;
  @Input() title = '';
  @Input() version = '';

  // Use a signal to make the content reactive for the computed value
  private contentSignal = signal('');
  @Input() set content(value: string) {
    this.contentSignal.set(value || '');
  }

  @Output() isOpenChange = new EventEmitter<boolean>();

  private sanitizer = inject(DomSanitizer);

  renderedContent = computed<SafeHtml>(() => {
    const rawContent = this.contentSignal();
    if (!rawContent) return '';

    try {
      const html = marked.parse(rawContent);
      return this.sanitizer.bypassSecurityTrustHtml(html as string);
    } catch (e) {
      console.error('Error parsing markdown', e);
      return 'Error al cargar el contenido.';
    }
  });

  onClose() {
    this.isOpenChange.emit(false);
  }
}
