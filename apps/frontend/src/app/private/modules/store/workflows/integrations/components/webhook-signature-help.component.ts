import { Component, signal } from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/index';

const NODE_EXAMPLE = `import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const ts = parts.t;
  const expected = createHmac('sha256', secret)
    .update(ts + '.' + rawBody)
    .digest('hex');
  const ok =
    expected.length === parts.v1.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) <= toleranceSec;
  return ok && fresh;
}`;

/** Collapsible "Verificar la firma" guide for receivers of outgoing webhooks. */
@Component({
  selector: 'app-webhook-signature-help',
  standalone: true,
  imports: [IconComponent],
  template: `
    <section class="rounded-2xl border border-border bg-surface" aria-label="Verificar la firma">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-bold text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        [attr.aria-expanded]="open()"
        (click)="open.set(!open())"
      >
        Verificar la firma
        <app-icon [name]="open() ? 'chevron-up' : 'chevron-down'" [size]="16" />
      </button>
      @if (open()) {
        <div class="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-text-primary">
          <p>Cada entrega es un POST con estos encabezados:</p>
          <ul class="list-disc pl-5">
            <li><code class="font-mono">X-Vendix-Signature: t=&lt;timestamp&gt;,v1=&lt;hex&gt;</code></li>
            <li><code class="font-mono">X-Vendix-Event</code>: tipo del evento.</li>
            <li><code class="font-mono">X-Vendix-Delivery</code>: id de la entrega.</li>
          </ul>
          <p>
            La firma <code class="font-mono">v1</code> es
            <code class="font-mono">hex(HMAC_SHA256(secreto, timestamp + "." + cuerpo_crudo))</code>.
            Calcúlala con el cuerpo sin modificar, compárala en tiempo constante y rechaza
            marcas de tiempo muy antiguas.
          </p>
          <pre class="overflow-x-auto rounded-lg bg-background p-2 font-mono">{{ example }}</pre>
          <p>
            Los reintentos repiten el mismo <code class="font-mono">event_id</code>: guárdalo para
            no procesar dos veces el mismo evento.
          </p>
        </div>
      }
    </section>
  `,
})
export class WebhookSignatureHelpComponent {
  readonly open = signal(false);
  readonly example = NODE_EXAMPLE;
}
