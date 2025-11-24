import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-order-details',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './order-details.component.html',
  styleUrls: ['./order-details.component.css'],
})
export class OrderDetailsComponent {
  orderId: string | null = null;

  constructor(private route: ActivatedRoute) {
    this.route.paramMap.subscribe((params) => {
      this.orderId = params.get('id');
    });
  }
}
