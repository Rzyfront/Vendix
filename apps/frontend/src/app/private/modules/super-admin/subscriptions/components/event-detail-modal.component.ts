import { Component, input, output } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import {
  ModalComponent,
  BadgeComponent,
  IconComponent,
} from '../../../../../shared/components';
import { SubscriptionEvent } from '../interfaces/subscription-admin.interface';

@Component({
  selector: 'app-event-detail-modal',
  standalone: true,
  imports: [ModalComponent, BadgeComponent, IconComponent, DatePipe, JsonPipe],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      title="Detalle del evento"
      size="lg"
      (isOpenChange)="onIsOpenChange($event)"
    >
      @if (event(); as e) {
        <div class="space-y-4 p-4 md:p-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-text-secondary text-xs mb-1">Tipo</div>
              <app-badge>{{ e.event_type }}</app-badge>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Fecha</div>
              <div class="font-medium text-text-primary">{{ e.created_at | date: 'medium' }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Suscripción</div>
              <div class="font-medium text-text-primary">#{{ e.subscription_id }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Disparado por</div>
              <div class="font-medium text-text-primary">{{ e.user_name ?? 'Sistema' }}</div>
            </div>
            <div class="md:col-span-2">
              <div class="text-text-secondary text-xs mb-1">Descripción</div>
              <div class="font-medium text-text-primary flex items-center gap-2">
                <app-icon name="activity" [size]="14"></app-icon>
                <span>{{ e.description }}</span>
              </div>
            </div>
          </div>

          <div>
            <div class="text-text-secondary text-xs mb-1">Payload (JSON)</div>
            <pre
              class="text-xs bg-background border border-border rounded-lg p-3 overflow-auto max-h-72"
            >{{ e.metadata | json }}</pre>
          </div>
        </div>
      }
    </app-modal>
  `,
})
export class EventDetailModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly event = input<SubscriptionEvent | null>(null);
  readonly closed = output<void>();

  onIsOpenChange(open: boolean): void {
    if (!open) this.closed.emit();
  }
}
