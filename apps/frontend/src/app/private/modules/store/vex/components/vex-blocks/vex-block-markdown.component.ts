import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { VexUiBlock } from '../../models/vex.models';
import { VexMarkdownComponent } from '../vex-markdown/vex-markdown.component';

/** `markdown` block: adapts the block payload to `vendix-vex-markdown`. */
@Component({
  selector: 'vendix-vex-block-markdown',
  standalone: true,
  imports: [VexMarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<vendix-vex-markdown [content]="content()" />`,
})
export class VexBlockMarkdownComponent {
  readonly block = input.required<VexUiBlock>();

  readonly content = computed(() => {
    const data = this.block().data;
    const value = data['content'] ?? data['text'];
    return typeof value === 'string' ? value : '';
  });
}
