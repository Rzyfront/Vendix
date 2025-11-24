import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { StoreOrdersService } from '../../services/store-orders.service';
import { OrderStats } from '../../interfaces/order.interface';

@Component({
  selector: 'app-order-stats',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './order-stats.component.html',
  styleUrls: ['./order-stats.component.css'],
})
export class OrderStatsComponent implements OnInit, OnDestroy {
  orderStats: OrderStats | null = null;
  isLoading = false;
  error: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(private storeOrdersService: StoreOrdersService) {}

  ngOnInit(): void {
    this.loadOrderStats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadOrderStats(): void {
    this.isLoading = true;
    this.error = null;

    this.storeOrdersService
      .getOrderStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: OrderStats) => {
          this.orderStats = stats;
          this.isLoading = false;
        },
        error: (err: any) => {
          this.error = 'Failed to load order statistics. Please try again.';
          this.isLoading = false;
          console.error('Error loading order stats:', err);
        },
      });
  }

  refreshStats(): void {
    this.loadOrderStats();
  }
}
