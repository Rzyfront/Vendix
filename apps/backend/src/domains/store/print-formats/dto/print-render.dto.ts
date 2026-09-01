import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';
import { PrintFormatTypeEnum } from '../enums/print-format.enum';

export class RenderPrintDocumentDto {
  @IsEnum(PrintFormatTypeEnum)
  format_type: PrintFormatTypeEnum;

  @IsNotEmpty()
  document_id: number | string;

  @IsOptional()
  @IsIn(['html', 'pdf'])
  engine?: 'html' | 'pdf' = 'html';

  /**
   * [print-fiscal-gate P7.2] — Cuando true, el renderer devuelve SOLO el
   * contenido interior del `<body>` del documento, sin `<!DOCTYPE>`, `<head>`
   * ni la envoltura `<html>`. El caller (el batch de impresión en
   * `pos-ticket.service.ts:printTicketsBatch`) usa este modo para
   * concatenar N cuerpos y envolver el resultado una sola vez con un
   * `<html>` único, evitando anidar documentos completos.
   *
   * El default `false` preserva la salida histórica para callers que aún
   * esperan un documento completo (preview, single-ticket print, etc.).
   */
  @IsOptional()
  @IsBoolean()
  body_only?: boolean = false;
}