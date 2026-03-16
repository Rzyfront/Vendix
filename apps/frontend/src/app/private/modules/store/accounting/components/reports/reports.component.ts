import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'vendix-reports',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="w-full">
      <router-outlet></router-outlet>
    </div>
  `,
})
export class ReportsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
