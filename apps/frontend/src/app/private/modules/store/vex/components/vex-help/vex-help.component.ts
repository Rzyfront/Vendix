import { ChangeDetectionStrategy, Component, model, output } from '@angular/core';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { VEX_COPY } from '../../vex-copy';

/**
 * «¿Cómo funciona Vex?»: confirmations, reminders, memory and real deletion,
 * in plain words. Opened from the welcome screen and from the page header.
 */
@Component({
  selector: 'vendix-vex-help',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="copy.title"
      [subtitle]="copy.subtitle"
      size="md"
      [closeOnBackdrop]="true"
    >
      <ul class="flex flex-col gap-4">
        @for (section of copy.sections; track section.title) {
          <li class="flex items-start gap-3">
            <span
              class="shrink-0 w-10 h-10 rounded-xl grid place-items-center bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <app-icon [name]="section.icon" [size]="16"></app-icon>
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-text-primary">{{ section.title }}</h3>
              <p class="text-sm text-text-secondary">{{ section.body }}</p>
            </div>
          </li>
        }
      </ul>
      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        <app-button variant="ghost" size="sm" (clicked)="replay()">
          {{ copy.replay_tour }}
        </app-button>
        <app-button size="sm" (clicked)="isOpen.set(false)">
          {{ copy.close }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class VexHelpComponent {
  readonly isOpen = model(false);
  /** The person wants to see the guided tour again. */
  readonly tourRequested = output<void>();

  protected readonly copy = VEX_COPY.help;

  protected replay(): void {
    this.isOpen.set(false);
    this.tourRequested.emit();
  }
}
