import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-customer-reviews',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './customer-reviews.component.html',
  styleUrls: ['./customer-reviews.component.css'],
})
export class CustomerReviewsComponent implements OnInit {
  reviews: any[] = [];
  loading = false;

  ngOnInit(): void {
    this.loadReviews();
  }

  // 🆕 MÉTODOS PLACEHOLDER PARA FUTURO
  loadReviews(): void {
    // TODO: Implementar carga de reseñas desde servicio
    console.log('Cargando reseñas...');
  }

  onReviewClick(review: any): void {
    // TODO: Implementar manejo de clic en reseña
    console.log('Reseña seleccionada:', review);
  }

  approveReview(reviewId: number): void {
    // TODO: Implementar aprobación de reseña
    console.log('Aprobando reseña:', reviewId);
  }

  rejectReview(reviewId: number): void {
    // TODO: Implementar rechazo de reseña
    console.log('Rechazando reseña:', reviewId);
  }
}
