import { Test, TestingModule } from '@nestjs/testing';
import { PrintTemplateCompilerService } from './print-template-compiler.service';
import { VendixHttpException } from 'src/common/errors';

describe('PrintTemplateCompilerService', () => {
  let service: PrintTemplateCompilerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrintTemplateCompilerService],
    }).compile();

    service = module.get<PrintTemplateCompilerService>(PrintTemplateCompilerService);
  });

  it('should compile simple variable tokens', () => {
    const template = '<h1>{{store.name}}</h1><p>Doc: #{{document.number}}</p>';
    const data = {
      store: { name: 'Mi Tienda' },
      document: { number: '1234' },
    };

    const res = service.compile(template, data);
    expect(res.compiled).toBe('<h1>Mi Tienda</h1><p>Doc: #1234</p>');
    expect(res.usedTokens).toContain('store.name');
    expect(res.usedTokens).toContain('document.number');
  });

  it('should escape HTML to prevent XSS attacks in standard tokens', () => {
    const template = '<div>{{customer.name}}</div>';
    const data = {
      customer: { name: '<script>alert("hack")</script>' },
    };

    const res = service.compile(template, data);
    expect(res.compiled).toBe('<div>&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt;</div>');
  });

  it('should handle format helper {{money path}}', () => {
    const template = '<span>Total: {{money totals.grand_total}}</span>';
    const data = {
      totals: { grand_total: 50000 },
    };

    const res = service.compile(template, data);
    expect(res.compiled).toContain('$50.000');
  });

  it('should handle {{#if condition}} blocks correctly', () => {
    const template = '{{#if customer.tax_id}}NIT: {{customer.tax_id}}{{else}}Consumidor Final{{/if}}';
    const dataWithNit = { customer: { tax_id: '900123' } };
    const dataWithoutNit = { customer: { tax_id: '' } };

    expect(service.compile(template, dataWithNit).compiled).toBe('NIT: 900123');
    expect(service.compile(template, dataWithoutNit).compiled).toBe('Consumidor Final');
  });

  it('should handle {{#each items}} loop blocks', () => {
    const template = '<ul>{{#each items}}<li>{{@number}}. {{product_name}} - {{money total_price}}</li>{{/each}}</ul>';
    const data = {
      items: [
        { product_name: 'Item A', total_price: 10000 },
        { product_name: 'Item B', total_price: 20000 },
      ],
    };

    const res = service.compile(template, data);
    expect(res.compiled).toContain('1. Item A - $10.000');
    expect(res.compiled).toContain('2. Item B - $20.000');
  });

  it('should throw VendixHttpException on syntax errors', () => {
    const badTemplate = '<div>{{#if user.name}}Hola {{user.name}}</div>'; // unclosed if
    expect(() => service.compile(badTemplate, {})).toThrow(VendixHttpException);
  });
});
