import { Component, computed, input } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/index';
import { AiFieldHint, hintText } from './document-ai-read.util';

/**
 * Note under a form field filled by "Leer con IA". Yellow with the confidence
 * and page when the confidence is low; a quiet note otherwise.
 */
@Component({
  selector: 'app-ai-field-note',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (hint(); as h) {
      <span
        class="flex items-center gap-1 rounded-md px-2 py-1 text-xs"
        [class.bg-warning-light]="h.low"
        [class.text-warning]="h.low"
        [class.text-text-secondary]="!h.low"
        [attr.title]="title()"
        [attr.data-ai-low]="h.low ? 'true' : null"
        data-testid="ai-field-note"
      >
        <app-icon [name]="h.low ? 'alert-triangle' : 'sparkles'" [size]="12" />
        {{ text() }}
      </span>
    }
  `,
})
export class AiFieldNoteComponent {
  readonly hint = input<AiFieldHint | null | undefined>(null);

  readonly text = computed(() => {
    const h = this.hint();
    return h ? hintText(h) : '';
  });

  readonly title = computed(() => {
    const h = this.hint();
    if (!h) return null;
    return h.page ? `El valor sale de la página ${h.page}` : 'Leído con IA';
  });
}
