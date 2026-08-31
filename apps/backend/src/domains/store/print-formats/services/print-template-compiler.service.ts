import { Injectable, Logger } from '@nestjs/common';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

export interface CompilationResult {
  compiled: string;
  usedTokens: string[];
}

@Injectable()
export class PrintTemplateCompilerService {
  private readonly logger = new Logger(PrintTemplateCompilerService.name);

  /**
   * Saneamiento HTML estricto para evitar XSS al renderizar variables
   */
  escapeHtml(value: any): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Resuelve el valor anidado a partir de un string de path (ej: "customer.name" o "order.grand_total")
   */
  resolvePath(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    const parts = path.trim().split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Valida la sintaxis de una plantilla custom y reporta tokens malformados o no cerrados
   */
  validateSyntax(template: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!template) return { valid: true, errors: [] };

    // Verificar balance de llaves
    let openCount = 0;
    for (let i = 0; i < template.length; i++) {
      if (template[i] === '{' && template[i + 1] === '{') {
        openCount++;
        i++;
      } else if (template[i] === '}' && template[i + 1] === '}') {
        openCount--;
        i++;
        if (openCount < 0) {
          errors.push('Llave de cierre "}}" encontrada sin etiqueta de apertura correspondiente');
          openCount = 0;
        }
      }
    }
    if (openCount > 0) {
      errors.push('Etiqueta "{{" abierta no fue cerrada correctamente con "}}"');
    }

    // Verificar bloques if / each no cerrados
    const ifOpens = (template.match(/\{\{#if\s+[^}]+\}\}/g) || []).length;
    const ifCloses = (template.match(/\{\{\/if\}\}/g) || []).length;
    if (ifOpens !== ifCloses) {
      errors.push(`Bloques {{#if}} abiertos (${ifOpens}) no coinciden con cierres {{/if}} (${ifCloses})`);
    }

    const eachOpens = (template.match(/\{\{#each\s+[^}]+\}\}/g) || []).length;
    const eachCloses = (template.match(/\{\{\/each\}\}/g) || []).length;
    if (eachOpens !== eachCloses) {
      errors.push(`Bloques {{#each}} abiertos (${eachOpens}) no coinciden con cierres {{/each}} (${eachCloses})`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Compila una plantilla con un modelo de datos seguro
   */
  compile(template: string, data: any, mode: 'dummy' | 'tokenized' = 'dummy'): CompilationResult {
    if (!template) return { compiled: '', usedTokens: [] };

    const validation = this.validateSyntax(template);
    if (!validation.valid) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_TOKEN_SYNTAX_001,
        `Errores de sintaxis en plantilla: ${validation.errors.join('; ')}`,
      );
    }

    const usedTokens: string[] = [];
    let result = template;

    // 1. Procesar bloques {{#each collection}}...{{/each}}
    const eachRegex = /\{\{#each\s+([a-zA-Z0-9_.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    result = result.replace(eachRegex, (_, collectionPath, innerTemplate) => {
      usedTokens.push(`each:${collectionPath}`);
      const collection = this.resolvePath(data, collectionPath);
      if (!Array.isArray(collection) || collection.length === 0) {
        if (mode === 'tokenized') {
          return `<div class="vendix-token-each" data-token="each:${collectionPath}"><span class="vendix-token-pill">#each ${collectionPath}</span>${this.compileInner(innerTemplate, { '@index': 0, '@number': 1 }, usedTokens, mode)}</div>`;
        }
        return '';
      }

      return collection
        .map((item, index) => {
          const itemContext = {
            ...data,
            this: item,
            item,
            '@index': index,
            '@number': index + 1,
            ...item,
          };
          return this.compileInner(innerTemplate, itemContext, usedTokens, mode);
        })
        .join('');
    });

    // 2. Procesar bloques {{#if condition}}...{{else}}...{{/if}}
    result = this.processConditionals(result, data, usedTokens);

    // 3. Procesar tokens simples y helpers
    result = this.processTokens(result, data, usedTokens, mode);

    // 4. Sanitizar HTML contra inyecciones de scripts y handlers maliciosos
    result = this.sanitizeHtml(result);

    return {
      compiled: result,
      usedTokens: Array.from(new Set(usedTokens)),
    };
  }

  private sanitizeHtml(html: string): string {
    if (!html) return '';
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s*on\w+\s*=\s*(['"]).*?\1/gi, '')
      .replace(/\s*on\w+\s*=\s*[^>\s]+/gi, '')
      .replace(/javascript:/gi, '');
  }

  private compileInner(template: string, data: any, usedTokens: string[], mode: 'dummy' | 'tokenized' = 'dummy'): string {
    let res = this.processConditionals(template, data, usedTokens);
    res = this.processTokens(res, data, usedTokens, mode);
    return res;
  }

  private processConditionals(template: string, data: any, usedTokens: string[]): string {
    const ifRegex = /\{\{#if\s+([!a-zA-Z0-9_.]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
    return template.replace(ifRegex, (_, conditionExpr, trueBranch, falseBranch = '') => {
      let isNegated = false;
      let path = conditionExpr.trim();
      if (path.startsWith('!')) {
        isNegated = true;
        path = path.slice(1).trim();
      }

      usedTokens.push(`if:${path}`);
      const val = this.resolvePath(data, path);

      let isTruthy = false;
      if (Array.isArray(val)) {
        isTruthy = val.length > 0;
      } else if (typeof val === 'number') {
        isTruthy = val > 0;
      } else if (typeof val === 'string') {
        isTruthy = val.trim().length > 0;
      } else {
        isTruthy = Boolean(val);
      }

      if (isNegated) {
        isTruthy = !isTruthy;
      }

      return isTruthy ? trueBranch : falseBranch;
    });
  }

  private processTokens(template: string, data: any, usedTokens: string[], mode: 'dummy' | 'tokenized' = 'dummy'): string {
    // Soportar {{#raw}}...{{/raw}} o triple llave {{{raw_html}}} para contenido HTML explícito (ej: QR svg o base64 image tag)
    const rawTokenRegex = /\{\{\{([@a-zA-Z0-9_.]+)\}\}\}/g;
    let res = template.replace(rawTokenRegex, (_, tokenPath) => {
      usedTokens.push(tokenPath);
      if (mode === 'tokenized') {
        return `<span class="vendix-token-pill" data-token="${tokenPath}">&#123;&#123;{ ${tokenPath} }&#125;&#125;</span>`;
      }
      const val = this.resolvePath(data, tokenPath);
      return val !== undefined && val !== null ? String(val) : '';
    });

    // Helper tokens: {{helperName path}}
    const helperRegex = /\{\{(money|date|upper|lower|raw)\s+([@a-zA-Z0-9_.]+)\}\}/g;
    res = res.replace(helperRegex, (_, helperName, tokenPath) => {
      usedTokens.push(`${helperName}:${tokenPath}`);
      if (mode === 'tokenized') {
        return `<span class="vendix-token-pill" data-token="${tokenPath}">&#123;&#123; ${helperName} ${tokenPath} &#125;&#125;</span>`;
      }
      const rawVal = this.resolvePath(data, tokenPath);
      if (rawVal === undefined || rawVal === null) return '';

      switch (helperName) {
        case 'money':
          const num = Number(rawVal);
          if (isNaN(num)) return this.escapeHtml(rawVal);
          return `$${num.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
        case 'date':
          const d = new Date(rawVal);
          if (isNaN(d.getTime())) return this.escapeHtml(rawVal);
          return d.toLocaleDateString('es-CO');
        case 'upper':
          return this.escapeHtml(String(rawVal).toUpperCase());
        case 'lower':
          return this.escapeHtml(String(rawVal).toLowerCase());
        case 'raw':
          return String(rawVal);
        default:
          return this.escapeHtml(rawVal);
      }
    });

    // Standard tokens: {{path.to.val}}
    const standardTokenRegex = /\{\{([@a-zA-Z0-9_.]+)\}\}/g;
    res = res.replace(standardTokenRegex, (_, tokenPath) => {
      usedTokens.push(tokenPath);
      if (mode === 'tokenized') {
        return `<span class="vendix-token-pill" data-token="${tokenPath}">&#123;&#123; ${tokenPath} &#125;&#125;</span>`;
      }
      const val = this.resolvePath(data, tokenPath);
      return this.escapeHtml(val);
    });

    return res;
  }
}
