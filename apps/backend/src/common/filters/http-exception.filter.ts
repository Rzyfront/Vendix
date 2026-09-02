import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from '../errors';
import { RequestContextService } from '../context/request-context.service';

/**
 * DESAJUSTE DE TIPO EN UN VALOR — el ÚNICO subconjunto de
 * `PrismaClientValidationError` que se traduce a 400.
 *
 * POR QUÉ EL CRITERIO ES TAN ESTRECHO. `PrismaClientValidationError` mezcla dos
 * poblaciones que no se parecen en nada:
 *
 *   1. «Unknown argument `foo`», «Argument `data` is missing», «needs at least
 *      one argument» ⇒ la consulta la construyó MAL Vendix. Es un bug del
 *      servidor. Si lo convirtiéramos en 400, el bug dejaría de aparecer en la
 *      tasa de 5xx y se volvería invisible justo cuando más urge verlo.
 *   2. «Invalid value provided. Expected Int, provided String» ⇒ el valor lo
 *      mandó el cliente. Eso sí es 400, y es lo único que este patrón captura.
 *
 * Se aceptan las dos redacciones porque Prisma cambió el texto entre mayores
 * («Got invalid value» en la 4.x, «Invalid value provided» desde la 5.x) y un
 * bump de versión no debe reabrir el 500 en silencio.
 *
 * LA TERCERA REDACCIÓN — «Unable to fit value N into a 64-bit signed integer»
 * — es de la misma población 2 y por el mismo motivo: el número lo escribió el
 * cliente. Es el hermano de P2020 un peldaño más arriba: P2020 lo rechaza
 * Postgres cuando el valor cabe en 64 bits pero no en la columna `Int`; ÉSTE lo
 * rechaza el serializador de Prisma cuando ni siquiera cabe en 64 bits, así que
 * la consulta nunca llega a la base y no hay código P20xx que mapear.
 *
 * Sin esta rama, CUALQUIER ruta con `:id` devolvía 500 ante un identificador
 * absurdamente largo: `ParseIntPipe` lo acepta —«99999999999999999999» es un
 * entero sintácticamente válido— y el fallo aparecía como `SYS_INTERNAL_001`.
 * Verificado sobre 11 rutas del dominio de facturación; el defecto no era de
 * facturación sino de este filtro, que es donde se corrige una sola vez.
 */
const PRISMA_VALUE_TYPE_MISMATCH =
  /Invalid value provided\.\s*Expected|Got invalid value|Unable to fit value .* into a 64-bit signed integer/i;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Extract error_code and details based on exception type
    let errorCode: string | undefined;
    let details: any;
    let message: any;

    if (exception instanceof VendixHttpException) {
      errorCode = exception.errorCode;
      const resp = exception.getResponse() as any;
      message = resp.message || resp;
      details = resp.details;
    } else if (exception instanceof HttpException) {
      const resp = exception.getResponse() as any;
      if (resp?.error_code) errorCode = resp.error_code;
      details = resp?.details;

      // QUI-606: si el exceptionFactory del ValidationPipe global (en
      // main.ts) ya produjo un `validationErrors[]` con shape canónico
      // (caso bulk customers), lo preservamos tal cual bajo `details`.
      if (Array.isArray(resp?.validationErrors)) {
        details = { ...(details || {}), validationErrors: resp.validationErrors };
      }

      // RED DE SEGURIDAD PARA EXCEPCIONES LEGADAS QUE PONEN `blockers` EN LA
      // RAÍZ DEL CUERPO.
      //
      // Este filtro RECONSTRUYE la respuesta: sólo `error_code`, `details` y
      // `validationErrors` sobreviven, así que cualquier
      // `new BadRequestException({ message, blockers })` perdía sus
      // bloqueadores en silencio y el cliente recibía «hay validaciones que
      // fallaron» sin una sola línea de cuáles. `details` es el ÚNICO punto de
      // lectura del frontend (`readApiBlockers` en
      // `core/utils/parse-api-error.ts` lee `details.blockers[]`), así que se
      // promueven acá.
      //
      // No duplica: si el servicio ya los mandó bajo `details` —que es la forma
      // correcta y la que usa `VendixHttpException`— esta rama no toca nada.
      if (Array.isArray(resp?.blockers) && !details?.blockers) {
        details = { ...(details || {}), blockers: resp.blockers };
      }

      const rawMessage =
        resp && typeof resp === 'object'
          ? (resp.message ?? resp.error ?? exception.message)
          : (resp ?? exception.message);

      if (Array.isArray(rawMessage)) {
        if (!errorCode) errorCode = 'SYS_VALIDATION_001';
        // Para el path no-bulk seguimos exponiendo el array de strings
        // estándar de NestJS, pero bajo `details.validationErrors` para
        // que el frontend tenga un único punto de lectura.
        if (!details?.validationErrors) {
          details = { ...(details || {}), validationErrors: rawMessage };
        }
        message = 'Validation failed';
      } else if (typeof rawMessage === 'string') {
        message = rawMessage;
      } else {
        message = exception.message || 'Request failed';
      }
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2020'
    ) {
      /**
       * P2020 — «value out of range for type integer».
       *
       * `ParseIntPipe` NO lo ataja: `999999999999999999` es un entero
       * sintácticamente válido, así que el pipe lo deja pasar y quien lo rechaza
       * es Postgres (SQLSTATE 22003) ya dentro de la consulta. El resultado era
       * un 500 por una petición que el cliente formuló mal, en CUALQUIER
       * endpoint con `:id`.
       *
       * Solo se traduce este código y ningún otro de la familia P20xx: P2002
       * (duplicado) y P2025 (no encontrado) ya los traducen los servicios que
       * saben QUÉ recurso está en juego, y hacerlo también acá les taparía el
       * mensaje de dominio con uno genérico.
       */
      const entry = ErrorCodes.SYS_VALUE_OUT_OF_RANGE_001;
      status = entry.httpStatus;
      errorCode = entry.code;
      message = entry.devMessage;
      // El texto crudo trae el fragmento de la invocación con nombres de tabla
      // y columna: se queda en el log del servidor, nunca en la respuesta.
      console.error(
        `[AllExceptionsFilter] Prisma P2020 on ${request.method} ${request.url}:`,
        exception.message,
      );
    } else if (
      exception instanceof Prisma.PrismaClientValidationError &&
      PRISMA_VALUE_TYPE_MISMATCH.test(exception.message)
    ) {
      const entry = ErrorCodes.SYS_INVALID_FIELD_VALUE_001;
      status = entry.httpStatus;
      errorCode = entry.code;
      message = entry.devMessage;
      // Mismo motivo que arriba: el mensaje de Prisma reproduce el objeto de la
      // consulta completo, con los nombres de campo del modelo.
      console.error(
        `[AllExceptionsFilter] Prisma validation (value type mismatch) on ${request.method} ${request.url}:`,
        exception.message,
      );
    } else {
      errorCode = 'SYS_INTERNAL_001';
      message = 'Internal server error';
      console.error(
        `[AllExceptionsFilter] Unhandled exception on ${request.method} ${request.url}:`,
        exception,
      );
    }

    const responseBody: Record<string, any> = {
      statusCode: status,
      ...(errorCode && { error_code: errorCode }),
      message,
      ...(details && { details }),
      // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 MAJOR.
      // Surface the per-request id from AsyncLocalStorage so the frontend
      // can quote it in the same toast it shows when something fails —
      // operators were stuck copy-pasting the timestamp and the order id to
      // get support to find their request.
      //
      // CP-PURCHASE-TRANSPARENCY H.1 — corrección de un comentario falso.
      // Aquí decía que «the audit log on the server side already carries it».
      // NO era cierto: `audit_logs` no tenía siquiera columna donde guardarlo,
      // y cuando la columna llegó nadie la escribía (0 de 33.590 filas). Ese
      // comentario era peor que no tener nada, porque afirmaba una garantía
      // inexistente sobre la que alguien podía diseñar. Desde H.1
      // `AuditService.log()` sí persiste `audit_logs.request_id`, PERO solo
      // cuando el ALS está poblado: el id que va en esta respuesta puede no
      // tener fila de auditoría gemela, y el que va en la auditoría puede
      // faltar. Correlacionar por este campo es best-effort, no una garantía.
      ...(RequestContextService.getRequestId()
        ? { request_id: RequestContextService.getRequestId() }
        : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Dev-friendly error details
    //
    // Política:
    // - production → NUNCA filtrar stack ni el objeto error. Aunque
    //   `NODE_ENV !== 'production'` ya bloqueaba prod, el bug que vimos en
    //   api.vendix.com era el camino inverso: cuando NODEENV estaba unset,
    //   `undefined !== 'production'` resuelve a true y el stack con paths
    //   internos (`/app/src/main.ts:303:27`, `@nestjs/core/...`) se filtraba
    //   a internet. Ahora la rama unset cae en "no exponer".
    // - dev (`development`/`dev`/`local`) → exponer para diagnosticar.
    // - staging/test/UNSET → no exponer por defecto. Si el operador quiere
    //   stack en staging debe setear `EXPOSE_DEV_ERRORS=true` explícito.
    const isProd = process.env.NODE_ENV === 'production';
    const exposeDevDetails =
      !isProd &&
      (['development', 'dev', 'local'].includes(
        process.env.NODE_ENV ?? '',
      ) ||
        process.env.EXPOSE_DEV_ERRORS === 'true');

    if (exposeDevDetails) {
      // Solo nombre + stack. NO se incluye `error: exception` (objeto entero)
      // porque en excepciones con `response.body` puede traer payload gigante
      // o referencias circulares que revientan JSON.stringify.
      responseBody['devDetails'] = {
        name: exception instanceof Error ? exception.name : 'UnknownException',
        stack: exception instanceof Error ? exception.stack : undefined,
      };
    }

    response.status(status).json(responseBody);
  }
}
