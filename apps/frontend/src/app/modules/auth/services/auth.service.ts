import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface RegisterOwnerDto {
  organizationName: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data?: any;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = 'http://localhost:3000/auth'; // Ajustar según la configuración

  constructor(private http: HttpClient) {}

  registerOwner(registerData: RegisterOwnerDto): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/register-owner`, registerData)
      .pipe(
        catchError(this.handleError)
      );
  }

  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'Ha ocurrido un error desconocido';

    if (error.error instanceof ErrorEvent) {
      // Error del lado del cliente
      errorMessage = error.error.message;
    } else {
      // Error del lado del servidor
      if (error.error?.message) {
        errorMessage = error.error.message;
      } else if (error.status === 400) {
        errorMessage = 'Datos inválidos. Por favor verifica la información.';
      } else if (error.status === 409) {
        errorMessage = 'El email ya está registrado.';
      } else if (error.status === 500) {
        errorMessage = 'Error interno del servidor. Inténtalo más tarde.';
      }
    }

    console.error('AuthService Error:', error);
    return throwError(() => new Error(errorMessage));
  }
}
