import { Component, computed, signal } from '@angular/core';
import { environment } from '../../../../../../../environments/environment';
import { IconComponent } from '../../../../../../shared/components/index';

/** Collapsible "Cómo usar la API" guide: auth, curl examples and routes. */
@Component({
  selector: 'app-api-usage-help',
  standalone: true,
  imports: [IconComponent],
  template: `
    <section class="rounded-2xl border border-border bg-surface" aria-label="Cómo usar la API">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-bold text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        [attr.aria-expanded]="open()"
        (click)="open.set(!open())"
      >
        Cómo usar la API
        <app-icon [name]="open() ? 'chevron-up' : 'chevron-down'" [size]="16" />
      </button>
      @if (open()) {
        <div class="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-text-primary">
          <p>
            Envía tu API key en el encabezado
            <code class="font-mono">Authorization: Bearer vdx_live_…</code>
            o en <code class="font-mono">X-Api-Key</code>. En los POST agrega
            <code class="font-mono">Idempotency-Key</code> para poder reintentar sin duplicar.
          </p>
          <div>
            <p class="font-semibold">Listar flujos publicados</p>
            <pre class="mt-1 overflow-x-auto rounded-lg bg-background p-2 font-mono">{{ listExample() }}</pre>
          </div>
          <div>
            <p class="font-semibold">Iniciar una solicitud</p>
            <pre class="mt-1 overflow-x-auto rounded-lg bg-background p-2 font-mono">{{ startExample() }}</pre>
          </div>
          <div>
            <p class="font-semibold">Rutas disponibles</p>
            <ul class="mt-1 list-disc pl-5">
              @for (route of routes; track route.path) {
                <li><code class="font-mono">{{ route.method }} {{ route.path }}</code> · {{ route.text }}</li>
              }
            </ul>
          </div>
        </div>
      }
    </section>
  `,
})
export class ApiUsageHelpComponent {
  readonly open = signal(false);
  private readonly base = `${environment.apiUrl}/v1/workflows`;

  readonly routes = [
    { method: 'GET', path: '/definitions', text: 'Flujos disponibles (lectura)' },
    { method: 'GET', path: '/instances', text: 'Solicitudes (lectura)' },
    { method: 'GET', path: '/instances/:id', text: 'Detalle de una solicitud (lectura)' },
    { method: 'POST', path: '/instances', text: 'Iniciar una solicitud (escritura)' },
    { method: 'GET', path: '/inbox', text: 'Tareas de la persona dueña de la key' },
    { method: 'POST', path: '/tasks/:id/complete', text: 'Completar una tarea (escritura)' },
  ];

  readonly listExample = computed(
    () => `curl ${this.base}/definitions \\\n  -H "Authorization: Bearer vdx_live_TU_API_KEY"`,
  );

  readonly startExample = computed(
    () =>
      `curl -X POST ${this.base}/instances \\\n` +
      `  -H "Authorization: Bearer vdx_live_TU_API_KEY" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -H "Idempotency-Key: $(uuidgen)" \\\n` +
      `  -d '{"definition_key":"compras","title":"Compra de insumos","data":{}}'`,
  );
}
