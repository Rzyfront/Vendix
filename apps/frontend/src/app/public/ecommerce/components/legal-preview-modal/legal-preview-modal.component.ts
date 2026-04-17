import {
  Component,
  model,
  input,
  output,
  inject,
  computed,
  signal,
  effect,
} from '@angular/core';

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-legal-preview-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './legal-preview-modal.component.html',
  styleUrl: './legal-preview-modal.component.scss',
})
export class LegalPreviewModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly title = input('');
  readonly version = input('');

  private contentSignal = signal('');
  readonly content = input('');

  constructor() {
    effect(() => {
      this.contentSignal.set(this.content() || '');
    });
  }

  readonly isOpenChange = output<boolean>();

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
