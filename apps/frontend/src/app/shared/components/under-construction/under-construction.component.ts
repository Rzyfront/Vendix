import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-under-construction',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div class="w-24 h-24 mb-6 rounded-full bg-primary/10 flex items-center justify-center">
        <app-icon name="cog" class="w-12 h-12 text-primary"></app-icon>
      </div>

      <h1 class="text-2xl font-bold text-foreground mb-2">
        {{ title }}
      </h1>

      <p class="text-muted-foreground max-w-md mb-6">
        {{ description }}
      </p>

      <button
        (click)="goBack()"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <app-icon name="arrow-left" class="w-4 h-4"></app-icon>
        Volver
      </button>
    </div>
  `,
})
export class UnderConstructionComponent implements OnInit {
  @Input() title = 'En Construcción';
  @Input() description = 'Este módulo está siendo desarrollado y estará disponible próximamente.';

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    if (data['title']) {
      this.title = data['title'];
    }
    if (data['description']) {
      this.description = data['description'];
    }
  }

  goBack(): void {
    window.history.back();
  }
}
