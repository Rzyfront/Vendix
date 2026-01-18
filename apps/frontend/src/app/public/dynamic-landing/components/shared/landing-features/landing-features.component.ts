import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-landing-features',
  standalone: true,
  imports: [CommonModule, CardComponent],
  template: `
    <section class="py-16 bg-[var(--color-surface)]">
      <div class="container mx-auto px-4">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <app-card 
            *ngFor="let feature of features" 
            class="h-full hover:shadow-lg transition-shadow duration-300"
            [animateOnLoad]="true">
            <div class="p-6">
              <h3 class="text-xl font-bold text-[var(--color-primary)] mb-3">
                {{ feature.title }}
              </h3>
              <p class="text-[var(--color-text-secondary)]">
                {{ feature.description }}
              </p>
            </div>
          </app-card>
        </div>
      </div>
    </section>
  `,
  styles: []
})
export class LandingFeaturesComponent {
  @Input() features: any[] = [];
}
