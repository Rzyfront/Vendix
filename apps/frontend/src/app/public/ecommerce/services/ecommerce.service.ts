import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  image: string;
  category: string;
  stock: number;
  onSale: boolean;
  featured: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  items: CartItem[];
  total: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: Date;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class EcommerceService {
  private apiUrl = '/api/ecommerce';

  constructor(private http: HttpClient) {}

  // Productos
  getProducts(params?: {
    category?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Observable<{ products: Product[]; total: number; page: number; limit: number }> {
    return this.http.get<{ products: Product[]; total: number; page: number; limit: number }>(
      `${this.apiUrl}/products`,
      { params: params as any }
    );
  }

  getProduct(id: number): Observable<Product> {
    return this.http.get<Product>(`${this.apiUrl}/products/${id}`);
  }

  getFeaturedProducts(): Observable<Product[]> {
    return this.http.get<Product[]>(`${this.apiUrl}/products/featured`);
  }

  getCategories(): Observable<{ id: string; name: string; productCount: number }[]> {
    return this.http.get<{ id: string; name: string; productCount: number }[]>(
      `${this.apiUrl}/categories`
    );
  }

  // Carrito
  getCart(): Observable<CartItem[]> {
    // En producción, esto vendría del backend
    const cart = localStorage.getItem('ecommerce_cart');
    return new Observable(observer => {
      if (cart) {
        observer.next(JSON.parse(cart));
      } else {
        observer.next([]);
      }
      observer.complete();
    });
  }

  addToCart(product: Product, quantity: number = 1): Observable<CartItem[]> {
    return this.getCart().pipe(
      map(cart => {
        const existingItem = cart.find(item => item.product.id === product.id);
        
        if (existingItem) {
          existingItem.quantity += quantity;
        } else {
          cart.push({ product, quantity });
        }

        localStorage.setItem('ecommerce_cart', JSON.stringify(cart));
        return cart;
      })
    );
  }

  updateCartItem(productId: number, quantity: number): Observable<CartItem[]> {
    return this.getCart().pipe(
      map(cart => {
        const itemIndex = cart.findIndex(item => item.product.id === productId);
        
        if (itemIndex > -1) {
          if (quantity <= 0) {
            cart.splice(itemIndex, 1);
          } else {
            cart[itemIndex].quantity = quantity;
          }
        }

        localStorage.setItem('ecommerce_cart', JSON.stringify(cart));
        return cart;
      })
    );
  }

  removeFromCart(productId: number): Observable<CartItem[]> {
    return this.getCart().pipe(
      map(cart => {
        const filteredCart = cart.filter(item => item.product.id !== productId);
        localStorage.setItem('ecommerce_cart', JSON.stringify(filteredCart));
        return filteredCart;
      })
    );
  }

  clearCart(): Observable<CartItem[]> {
    localStorage.removeItem('ecommerce_cart');
    return new Observable(observer => {
      observer.next([]);
      observer.complete();
    });
  }

  // Órdenes
  createOrder(orderData: {
    customerName: string;
    customerEmail: string;
    shippingAddress: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
    items: CartItem[];
  }): Observable<Order> {
    return this.http.post<Order>(`${this.apiUrl}/orders`, orderData);
  }

  getOrder(orderId: string): Observable<Order> {
    return this.http.get<Order>(`${this.apiUrl}/orders/${orderId}`);
  }

  getOrdersByEmail(email: string): Observable<Order[]> {
    return this.http.get<Order[]>(`${this.apiUrl}/orders/customer/${email}`);
  }

  // Wishlist
  getWishlist(): Observable<Product[]> {
    const wishlist = localStorage.getItem('ecommerce_wishlist');
    return new Observable(observer => {
      if (wishlist) {
        observer.next(JSON.parse(wishlist));
      } else {
        observer.next([]);
      }
      observer.complete();
    });
  }

  addToWishlist(product: Product): Observable<Product[]> {
    return this.getWishlist().pipe(
      map(wishlist => {
        const existingProduct = wishlist.find(p => p.id === product.id);
        
        if (!existingProduct) {
          wishlist.push(product);
          localStorage.setItem('ecommerce_wishlist', JSON.stringify(wishlist));
        }

        return wishlist;
      })
    );
  }

  removeFromWishlist(productId: number): Observable<Product[]> {
    return this.getWishlist().pipe(
      map(wishlist => {
        const filteredWishlist = wishlist.filter(p => p.id !== productId);
        localStorage.setItem('ecommerce_wishlist', JSON.stringify(filteredWishlist));
        return filteredWishlist;
      })
    );
  }

  // Búsqueda y Filtros
  searchProducts(query: string): Observable<Product[]> {
    return this.http.get<Product[]>(`${this.apiUrl}/products/search`, {
      params: { q: query }
    });
  }

  getProductsByCategory(categoryId: string): Observable<Product[]> {
    return this.http.get<Product[]>(`${this.apiUrl}/categories/${categoryId}/products`);
  }

  // Utilidades
  calculateCartTotal(cart: CartItem[]): number {
    return cart.reduce((total, item) => total + (item.product.price * item.quantity), 0);
  }

  getCartItemCount(cart: CartItem[]): number {
    return cart.reduce((count, item) => count + item.quantity, 0);
  }

  isProductInStock(product: Product, quantity: number = 1): boolean {
    return product.stock >= quantity;
  }
}