import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CrmBlock } from './landing-blocks.types';

/** Sobre el negocio. Props: title?, body (párrafos separados por línea vacía). */
@Component({
  selector: 'app-about-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="about">
      @if (props()['title']) {
        <h2>{{ props()['title'] }}</h2>
      }
      <div class="about-body">
        @for (paragraph of paragraphs(); track $index) {
          <p>{{ paragraph }}</p>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .about {
        padding: 32px 16px;
        max-width: 640px;
        margin: 0 auto;
      }
      h2 {
        text-align: center;
        font-size: 1.4rem;
        margin: 0 0 16px;
      }
      .about-body p {
        color: #374151;
        line-height: 1.7;
      }
    `,
  ],
})
export class AboutBlockComponent {
  readonly props = input.required<Record<string, unknown>>();

  readonly paragraphs = computed<string[]>(() => {
    const body = this.props()['body'];
    if (!body) return [];
    if (Array.isArray(body)) {
      return body.map((p) => String(p).trim()).filter(Boolean);
    }
    if (typeof body === 'string') {
      return body
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
    }
    return [String(body)];
  });
}
