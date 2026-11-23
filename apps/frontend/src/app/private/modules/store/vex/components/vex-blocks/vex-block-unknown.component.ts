import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexUiBlock } from '../../models/vex.models';
import { VEX_COPY } from '../../vex-copy';

/** Placeholder for a block kind this client version cannot render. */
@Component({
  selector: 'vendix-vex-block-unknown',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p
      class="rounded-2xl border border-border bg-surface px-4 py-3 m-0 flex items-center gap-2 text-sm text-text-secondary"
      role="note"
    >
      <app-icon name="info" [size]="16"></app-icon>
      {{ copy.message }}
    </p>
  `,
})
export class VexBlockUnknownComponent {
  protected readonly copy = VEX_COPY.blocks.unknown;
  readonly block = input<VexUiBlock>();
}
