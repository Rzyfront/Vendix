import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
  StickyHeaderComponent,
} from '../../../../../../../shared/components/index';
import { toWorkflowError } from '../../../utils/workflow-errors.util';
import { ConnectorTestModalComponent } from '../../components/connector-test-modal.component';
import { ConnectorView } from '../../interfaces/connectors.interfaces';
import { ConnectorsApiService } from '../../services/connectors-api.service';
import {
  CONNECTOR_FIX_LINK,
  CONNECTOR_ICON,
  CONNECTOR_STATE_LABEL,
  CONNECTOR_STATE_VARIANT,
  inputTypeLabel,
  triggerLabel,
} from '../../utils/connectors-ui.util';

/** `/admin/workflows/connectors`: what each connector offers, its real status and its test. */
@Component({
  selector: 'app-connectors-page',
  standalone: true,
  imports: [
    RouterLink,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    StickyHeaderComponent,
    ConnectorTestModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Conectores"
        subtitle="Lo que tus flujos pueden usar: estado de cada conexión, sus acciones y disparadores"
        icon="plug"
        variant="glass"
      />

      @if (errorMessage()) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ errorMessage() }}</app-alert-banner>
      } @else if (loading()) {
        <p class="py-8 text-center text-sm text-text-secondary" role="status">Cargando conectores...</p>
      } @else if (connectors().length === 0) {
        <app-empty-state
          icon="plug"
          title="Sin conectores"
          description="No hay conectores disponibles para esta tienda."
          [showActionButton]="false"
        />
      } @else {
        <div class="grid grid-cols-1 gap-3 p-2 md:grid-cols-2 md:gap-4 md:p-4 xl:grid-cols-3">
          @for (c of connectors(); track c.key) {
            <article
              class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
              [attr.aria-label]="c.label"
            >
              <header class="flex items-start justify-between gap-2">
                <div class="flex min-w-0 items-center gap-3">
                  <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background text-primary"
                  >
                    <app-icon [name]="iconOf(c)" [size]="20" />
                  </span>
                  <h2 class="truncate text-base font-semibold text-text-primary">{{ c.label }}</h2>
                </div>
                <app-badge [variant]="variantOf(c)" size="sm">{{ stateLabel(c) }}</app-badge>
              </header>

              <p class="text-sm text-text-secondary">{{ c.description }}</p>

              <div class="flex flex-col gap-1 text-sm">
                <p class="font-medium text-text-primary">{{ c.status.summary }}</p>
                @if (c.status.details['domain']) {
                  <p class="text-text-secondary">Dominio de recepción: {{ c.status.details['domain'] }}</p>
                }
                @if (c.status.missing) {
                  <p class="text-text-secondary">
                    <span class="font-medium">Falta:</span> {{ c.status.missing }}
                  </p>
                }
                @if (c.status.state !== 'connected') {
                  @if (fixLink(c); as link) {
                    <a
                      [routerLink]="link.route"
                      class="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      {{ link.label }}
                      <app-icon name="external-link" [size]="14" />
                    </a>
                  }
                }
              </div>

              @if (c.actions.length > 0) {
                <section class="flex flex-col gap-2">
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-text-secondary">Acciones</h3>
                  @for (a of c.actions; track a.name) {
                    <details class="rounded-lg border border-border bg-background px-3 py-2">
                      <summary class="cursor-pointer text-sm font-medium text-text-primary">
                        {{ a.label }}
                      </summary>
                      <ul class="mt-2 flex flex-col gap-1 text-sm">
                        @for (i of a.inputs; track i.key) {
                          <li class="flex flex-wrap items-baseline gap-x-2">
                            <span class="text-text-primary">{{ i.label }}</span>
                            <span class="text-xs text-text-secondary">
                              {{ typeLabel(i.type) }}{{ i.required ? ' · obligatorio' : '' }}
                            </span>
                          </li>
                        }
                      </ul>
                      <p class="mt-2 text-xs text-text-secondary">Permiso: {{ a.permission }}</p>
                    </details>
                  }
                </section>
              }

              @if (c.triggers.length > 0) {
                <section class="flex flex-col gap-2">
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-text-secondary">Disparadores</h3>
                  <div class="flex flex-wrap gap-2">
                    @for (t of c.triggers; track t) {
                      <app-badge variant="neutral" size="sm">{{ trigger(t) }}</app-badge>
                    }
                  </div>
                </section>
              }

              <footer class="mt-auto pt-1">
                @if (c.testable) {
                  <app-button variant="outline" size="sm" (clicked)="openTest(c)">
                    <app-icon name="flask-conical" [size]="14" slot="icon" />
                    Probar
                  </app-button>
                } @else {
                  <p class="text-xs text-text-secondary">Se prueba desde su flujo.</p>
                }
              </footer>
            </article>
          }
        </div>
      }
    </div>

    <app-connector-test-modal [(isOpen)]="testOpen" [connector]="testTarget()" />
  `,
})
export class ConnectorsPageComponent implements OnInit {
  private readonly api = inject(ConnectorsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly connectors = signal<ConnectorView[]>([]);
  readonly testOpen = signal(false);
  readonly testTarget = signal<ConnectorView | null>(null);

  ngOnInit(): void {
    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.connectors.set(rows);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.errorMessage.set(toWorkflowError(error).message);
          this.loading.set(false);
        },
      });
  }

  iconOf(c: ConnectorView): string {
    return CONNECTOR_ICON[c.key] ?? 'plug';
  }
  stateLabel(c: ConnectorView): string {
    return CONNECTOR_STATE_LABEL[c.status.state];
  }
  variantOf(c: ConnectorView) {
    return CONNECTOR_STATE_VARIANT[c.status.state];
  }
  fixLink(c: ConnectorView) {
    return CONNECTOR_FIX_LINK[c.key] ?? null;
  }
  typeLabel(type: string): string {
    return inputTypeLabel(type);
  }
  trigger(kind: string): string {
    return triggerLabel(kind);
  }

  openTest(c: ConnectorView): void {
    this.testTarget.set(c);
    this.testOpen.set(true);
  }
}
