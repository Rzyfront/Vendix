import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CrmBlock } from './landing-blocks.types';

interface FeatureItem {
  title: string;
  description: string;
}

/**
 * Beneficios. Props: title?, items (texto "Título | Descripción" por línea).
 * El formato pipe mantiene el editor v1 libre de sub-formularios.
 */
@Component({
  selector: 'app-features-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="features">
      @if (props()['title']) {
        <h2>{{ props()['title'] }}</h2>
      }
      <div class="features-grid">
        @for (item of items(); track item.title + $index) {
          <article class="feature-card">
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
          </article>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .features {
        padding: 32px 16px;
      }
      h2 {
        text-align: center;
        font-size: 1.4rem;
        margin: 0 0 20px;
      }
      .features-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        max-width: 860px;
        margin: 0 auto;
      }
      .feature-card {
        background: var(--bg-surface, #fff);
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 16px;
      }
      .feature-card h3 {
        margin: 0 0 6px;
        font-size: 1rem;
      }
      .feature-card p {
        margin: 0;
        color: #4b5563;
        font-size: 0.9rem;
        line-height: 1.5;
      }
    `,
  ],
})
export class FeaturesBlockComponent {
  readonly props = input.required<Record<string, unknown>>();

  readonly items = computed<FeatureItem[]>(() => {
    const raw = this.props()['items'];
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return (raw as any[]).map((it) => ({
        title: String(it?.title || it?.name || ''),
        description: String(it?.description || it?.desc || ''),
      }));
    }
    if (typeof raw === 'string') {
      return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [title, description = ''] = line.split('|');
          return { title: title.trim(), description: description.trim() };
        });
    }
    return [];
  });
}
