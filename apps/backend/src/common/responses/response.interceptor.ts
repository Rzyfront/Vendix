import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response } from 'express';
import { ErrorResponse, SuccessResponse } from './response.interface';

/**
 * Interceptor para establecer el código de estado HTTP en el header
 * basado en el campo statusCode del body de la respuesta
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data) => {
        // Si la respuesta tiene un statusCode, establecerlo en el header
        if (data && typeof data === 'object') {
          // Para respuestas de error con statusCode
          if ('statusCode' in data && typeof data.statusCode === 'number') {
            response.status(data.statusCode);
          }
          // Para respuestas exitosas, usar códigos apropiados
          else if ('success' in data && data.success === true) {
            // Si no tiene statusCode explícito, usar el apropiado según el contexto
            const method = context.switchToHttp().getRequest().method;

            // POST -> 201 Created (si no se especifica otro)
            if (method === 'POST' && response.statusCode === HttpStatus.OK) {
              response.status(HttpStatus.CREATED);
            }
            // DELETE -> 204 No Content si data es null
            else if (method === 'DELETE' && data.data === null) {
              response.status(HttpStatus.NO_CONTENT);
            }
            // Por defecto mantener 200 OK
          }
          // Para respuestas de error sin statusCode (fallback)
          else if ('success' in data && data.success === false) {
            if (!response.statusCode || response.statusCode === HttpStatus.OK) {
              response.status(HttpStatus.BAD_REQUEST);
            }
          }
        }

        return data;
      }),
    );
  }
}
