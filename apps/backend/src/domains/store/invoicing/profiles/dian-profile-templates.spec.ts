import {
  DIAN_PROFILE_TEMPLATES,
  DIAN_PROFILE_TEMPLATE_VERSION,
  findDianProfileTemplate,
} from './dian-profile-templates';
import {
  AIU_TAXABLE_COMPONENTS_BY_REGIME,
  INVOICE_PROFILE_CONFIG_VERSION,
  blockingIssues,
  normalizeInvoiceProfileConfig,
  validateInvoiceProfileConfig,
} from './invoice-profile-config.contract';
import type { AiuComponentLiteral } from './invoice-profile-config.contract';

describe('DIAN_PROFILE_TEMPLATES', () => {
  it('cada plantilla es GUARDABLE tal cual: ningún problema bloqueante', () => {
    // Ésta es la aserción que justifica el archivo. Una plantilla inválida sería
    // la configuración inicial de todos los tenants que la elijan, y el error se
    // descubriría al emitir — cuando el consecutivo ya se gastó.
    for (const template of DIAN_PROFILE_TEMPLATES) {
      const issues = blockingIssues(
        validateInvoiceProfileConfig(template.config, {
          operation_type: template.operation_type,
        }),
      );
      expect({ key: template.key, issues }).toEqual({
        key: template.key,
        issues: [],
      });
    }
  });

  it('lo único pendiente en una plantilla AIU es el objeto del contrato', () => {
    // Y es un AVISO, no un error: sólo el usuario lo conoce, y exigirlo al
    // guardar produce relleno — que pasa la puerta de emisión y termina impreso
    // como objeto del contrato, mientras el vacío falla antes del consecutivo.
    for (const template of DIAN_PROFILE_TEMPLATES) {
      const issues = validateInvoiceProfileConfig(template.config, {
        operation_type: template.operation_type,
      });
      const expected = template.config.aiu
        ? [{ field: 'aiu.contract_object', code: 'AIU_CONTRACT_OBJECT_EMPTY' }]
        : [];
      expect(issues.map(({ field, code }) => ({ field, code }))).toEqual(
        expected,
      );
    }
  });

  it('cada plantilla atraviesa el normalizador sin perder ni ganar nada', () => {
    for (const template of DIAN_PROFILE_TEMPLATES) {
      const { config, issues } = normalizeInvoiceProfileConfig(template.config);
      expect({ key: template.key, issues }).toEqual({
        key: template.key,
        issues: [],
      });
      expect(config).toEqual(template.config);
    }
  });

  it('la matriz de impuestos de cada plantilla AIU concuerda con su régimen', () => {
    // El fallo que este plan existe para cerrar: el régimen decide qué línea
    // emite `cac:TaxTotal` y los importes salen de los tributos persistidos. Si
    // las dos mitades salen de regímenes distintos, el XML declara una
    // gravabilidad que contradice sus propios números → rechazo FAU04.
    for (const template of DIAN_PROFILE_TEMPLATES) {
      if (!template.config.aiu) continue;
      const expected =
        AIU_TAXABLE_COMPONENTS_BY_REGIME[template.config.aiu.regime];
      for (const rule of template.config.taxes.rules) {
        if (rule.bucket === 'costo') {
          expect(rule.taxable).toBe(false);
          continue;
        }
        // Narrowing: `costo` ya salió por la rama de arriba, así que la
        // porción es un componente del AIU y `includes` compila.
        const bucket = rule.bucket as AiuComponentLiteral;
        expect({ key: template.key, bucket, taxable: rule.taxable }).toEqual({
          key: template.key,
          bucket,
          taxable: expected.includes(bucket),
        });
      }
    }
  });

  it('los dos regímenes AIU están cubiertos por una plantilla cada uno', () => {
    const regimes = DIAN_PROFILE_TEMPLATES.filter((t) => t.config.aiu).map(
      (t) => t.config.aiu!.regime,
    );
    expect(regimes.sort()).toEqual(['decreto_1372_1992', 'et_462_1']);
  });

  it('la plantilla estándar no trae sección AIU', () => {
    const standard = findDianProfileTemplate('dian-standard');
    expect(standard?.operation_type).toBe('10');
    expect(standard?.config.aiu).toBeNull();
  });

  it('las claves son únicas y todas resolubles por findDianProfileTemplate', () => {
    const keys = DIAN_PROFILE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(findDianProfileTemplate(key)?.key).toBe(key);
    }
    expect(findDianProfileTemplate('no-existe')).toBeUndefined();
  });

  it('la versión de la plantilla y la del snapshot son campos distintos', () => {
    // Confundirlas haría que publicar una plantilla nueva pareciera un cambio de
    // forma del snapshot, y al revés.
    for (const template of DIAN_PROFILE_TEMPLATES) {
      expect(template.template_version).toBe(DIAN_PROFILE_TEMPLATE_VERSION);
      expect(template.config.config_version).toBe(
        INVOICE_PROFILE_CONFIG_VERSION,
      );
    }
  });
});
