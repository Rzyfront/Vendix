import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';

/**
 * CP-DTLP-20260827 (Phase B.6) — La lista de formatos FISCALES es explícita y
 * vive en una constante exportada. Cualquier formato que NO esté en este set
 * corta la validación inmediatamente, sin tocar la definición.
 *
 * ¿Por qué un `Set<string>` y no un array? El `print_format_type_enum` del
 * cliente Prisma todavía no conoce `dispatch_ticket` (lo agregará el próximo
 * `prisma generate` tras la migración `20260827120000_add_dispatch_ticket_to_enum`).
 * Un set de strings acepta el literal sin que tsc se queje, y el `.has(...)`
 * sigue siendo O(1).
 */
export const FISCAL_FORMATS: ReadonlySet<string> = new Set([
  'fiscal_electronic_invoice',
  'fiscal_credit_note',
  // `pos_electronic_invoice` — la representación gráfica térmica de 80mm de
  // la factura electrónica en el mostrador POS. Es tan fiscal como las dos
  // de arriba (mismo Anexo Técnico 1.9 de la DIAN, mismos requisitos de
  // CUFE/QR/resolución); sin este valor, un formato guardado sin esos
  // campos pasaba la validación y el cliente se iba con un papel que
  // aparenta ser factura electrónica pero no lo es.
  'pos_electronic_invoice',
]);

@Injectable()
export class PrintFiscalValidatorService {
  private readonly logger = new Logger(PrintFiscalValidatorService.name);

  /**
   * Verifica que las representaciones gráficas de factura y nota crédito electrónica
   * cumplan los requisitos obligatorios del Anexo Técnico 1.9 de la DIAN.
   *
   * CP-853-fix (paso 2): esta función ya NO valida la leyenda no fiscal del
   * `pos_sale_ticket` (`f_disclaimer`). Esa regla es de PLANTILLA (se exige al
   * guardar en el Hub / biblioteca), no de impresión: un override guardado
   * antes de que la regla existiera nunca debe bloquear la impresión de la
   * tirilla en producción. Ver `assertSaveCompliance` más abajo, que sí la
   * incluye. `print-gateway.service.ts` (impresión) usa este método;
   * `print-formats.service.ts` (guardado) usa `assertSaveCompliance`.
   */
  assertFiscalCompliance(
    formatType: print_format_type_enum,
    definition: PrintFormatDefinition,
  ): void {
    if (!FISCAL_FORMATS.has(formatType as string)) {
      // Los formatos no fiscales no tienen restricciones DIAN obligatorias.
      // Antes de B.6 había dos comparaciones explícitas
      // (`formatType !== 'fiscal_electronic_invoice' && ... !== 'fiscal_credit_note'`);
      // ahora la guarda es declarativa para que añadir el undécimo formato
      // (dispatch_ticket) no requiera tocar este archivo.
      return;
    }

    if (!definition) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_FISCAL_STRUCTURE_VIOLATION_001,
        'La definición del formato fiscal no puede ser nula.',
      );
    }

    // Si usa plantilla custom, debe contener tokens indispensables de DIAN
    if (definition.custom_template && definition.custom_template.trim().length > 0) {
      const template = definition.custom_template;
      const missingTokens: string[] = [];

      if (!template.includes('fiscal.cufe') && !template.includes('fiscal.cude')) {
        missingTokens.push('{{fiscal.cufe}} o {{fiscal.cude}}');
      }
      if (!template.includes('fiscal.qr_code_png_base64') && !template.includes('fiscal.qr_code_content')) {
        missingTokens.push('{{fiscal.qr_code_png_base64}}');
      }
      if (!template.includes('store.tax_id')) {
        missingTokens.push('{{store.tax_id}} (NIT Emisor)');
      }

      if (missingTokens.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.PRINT_FISCAL_STRUCTURE_VIOLATION_001,
          `La plantilla custom fiscal debe incluir obligatoriamente los siguientes elementos DIAN: ${missingTokens.join(', ')}.`,
        );
      }
      return;
    }

    // Si usa definición estructurada, verificar presencia y activación de secciones obligatorias
    const sections = definition.sections || [];
    const enabledSectionTypes = new Set(
      sections.filter((s) => s.enabled).map((s) => s.type),
    );

    const missingSectionTypes: string[] = [];

    if (!enabledSectionTypes.has('fiscal_header') && !enabledSectionTypes.has('header')) {
      missingSectionTypes.push('Cabecera Fiscal (Datos del Emisor)');
    }
    if (!enabledSectionTypes.has('fiscal_cufe_box') && !enabledSectionTypes.has('document_info')) {
      missingSectionTypes.push('Bloque de CUFE / CUDE');
    }
    if (!enabledSectionTypes.has('fiscal_qr_section')) {
      missingSectionTypes.push('Código QR de Validación DIAN');
    }
    if (!enabledSectionTypes.has('items_table')) {
      missingSectionTypes.push('Tabla de Ítems / Bienes y Servicios');
    }
    if (!enabledSectionTypes.has('totals_summary')) {
      missingSectionTypes.push('Resumen de Totales e Impuestos');
    }

    if (missingSectionTypes.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_FISCAL_STRUCTURE_VIOLATION_001,
        `El formato fiscal no puede omitir las siguientes secciones exigidas por la DIAN: ${missingSectionTypes.join(', ')}.`,
      );
    }
  }

  /**
   * CP-853-fix (paso 2): validación exigida SOLO al guardar (Hub y biblioteca
   * de plantillas), nunca al imprimir. Compone la validación fiscal DIAN
   * (`assertFiscalCompliance`) más la regla de la leyenda no fiscal del
   * `pos_sale_ticket`, que antes vivía dentro de `assertFiscalCompliance` y
   * bloqueaba la impresión de overrides guardados antes de que la regla
   * existiera. Usada por `print-formats.service.ts` en create/update.
   */
  assertSaveCompliance(
    formatType: print_format_type_enum,
    definition: PrintFormatDefinition,
  ): void {
    this.assertFiscalCompliance(formatType, definition);

    // Tiquete POS: la leyenda no fiscal es obligatoria (espejo del requisito
    // CUFE/QR en formatos fiscales). Estructurada: campo `f_disclaimer`
    // habilitado en el footer; custom: substring del token. Cualquier otro
    // formato no fiscal sigue pasando sin chequeos (B.6 intacto).
    if ((formatType as string) === 'pos_sale_ticket') {
      const hasField = (definition?.sections ?? []).some(
        (s: any) =>
          s?.type === 'footer' &&
          (s.fields ?? []).some(
            (f: any) => f?.id === 'f_disclaimer' && f?.enabled === true,
          ),
      );
      const hasToken = (
        (definition as any)?.custom_template ?? ''
      ).includes('document.non_fiscal_disclaimer');
      if (!hasField && !hasToken) {
        throw new VendixHttpException(
          // Código propio (no el 001 fiscal): el invariante B.6 reserva
          // PRINT_FISCAL_STRUCTURE_VIOLATION_001 a formatos fiscales.
          ErrorCodes.PRINT_TICKET_DISCLAIMER_REQUIRED_001,
          'El Ticket de Venta POS debe declarar que no es factura electrónica: ' +
            'incluya el campo "Leyenda No Fiscal" habilitado en el pie, o el token ' +
            '{{document.non_fiscal_disclaimer}} en plantillas personalizadas.',
        );
      }
    }
  }
}
