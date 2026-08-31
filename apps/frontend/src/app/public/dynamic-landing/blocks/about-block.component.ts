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
  readonly props = input.required<Record<string, string>>();

  readonly paragraphs = computed<string[]>(() =>
    (this.props()['body'] ?? '')
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean),
  );
}
