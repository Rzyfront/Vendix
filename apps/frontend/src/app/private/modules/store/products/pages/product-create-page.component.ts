import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import {
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../shared/components';
import {
  ProductManagementComponent,
  ProductManagementMode,
} from '../components/product-management.component';
import { ProductsService } from '../services/products.service';

@Component({
  selector: 'app-product-create-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    ProductManagementComponent,
  ],
  template: `
    <div class="container mx-auto px-4 py-8">
      <div class="mb-8">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-3xl font-bold text-gray-900">Create New Product</h1>
            <p class="mt-2 text-gray-600">
              Add a new product to your inventory
            </p>
          </div>
          <app-button variant="outline" (clicked)="goBack()">
            <app-icon name="arrow-left" [size]="16" slot="icon"></app-icon>
            Back to Products
          </app-button>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow-sm border">
        <app-product-management
          [isOpen]="true"
          [isSubmitting]="isSubmitting"
          [mode]="{ type: 'create' }"
          (submit)="onProductCreated($event)"
          (cancel)="goBack()"
        ></app-product-management>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ProductCreatePageComponent implements OnInit {
  isSubmitting = false;

  constructor(
    private router: Router,
    private productsService: ProductsService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {}

  onProductCreated(productData: any): void {
    this.toastService.success('Product created successfully!');
    this.router.navigate(['/private/store/products']);
  }

  goBack(): void {
    this.router.navigate(['/private/store/products']);
  }
}
