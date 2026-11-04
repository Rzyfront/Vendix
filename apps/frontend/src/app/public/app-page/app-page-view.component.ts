import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type {
  AppPageDocument,
  PageAppKind,
} from '../../private/modules/store/apps/templates/app-page.types';

/**
 * Apps F2 — public renderer of an app's own page (hero + its own blocks).
 * STUB: contract only (inputs). Implemented in apps-f2 T3.
 */
@Component({
  selector: 'app-app-page-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class AppPageViewComponent {
  readonly kind = input.required<PageAppKind>();
  readonly page = input<AppPageDocument | null>(null);
  /** `'hero'`: only the hero; `'blocks'`: only the blocks; `'all'`: both. */
  readonly part = input<'hero' | 'blocks' | 'all'>('all');
  /** Admin preview: shows a placeholder where an existing section goes. */
  readonly preview = input(false);
}
