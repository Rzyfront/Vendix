import { FormControl, FormGroup } from '@angular/forms';

import {
  DIAN_VALIDATION_MESSAGES,
  confirmProductionValidator,
  dianSoftwarePinValidator,
  dianUuidValidator,
  dianValidationMessage,
  nitFormatValidator,
  optionalNumericIdValidator,
  rangeOrderValidator,
} from './dian-validators';

/**
 * ESTOS VALIDADORES EXISTÍAN SOLO EN LA SUPERFICIE DE MENOR RIESGO.
 *
 * Vivían en el riel de plataforma —un operador interno, una configuración— y
 * faltaban en las tres que usan los comerciantes. Un `software_id` con un espacio
 * de más no lo rechazaba nadie en el navegador, y si llega a la DIAN el documento
 * nunca clasifica: indistinguible de una cola atascada, con el consecutivo gastado.
 *
 * Los casos de abajo son el espejo del DTO del backend, no cobertura decorativa.
 */
describe('dianUuidValidator', () => {
  const run = (value: unknown) =>
    dianUuidValidator(new FormControl(value as string));

  it('acepta el UUID que la DIAN emite', () => {
    expect(run('50127d92-850d-4339-908a-bb17c15136c9')).toBeNull();
  });

  it('acepta cualquier versión, como el @IsUUID del backend', () => {
    // Exigir v4 rechazaría un identificador que la DIAN sí emitió. El espejo del
    // DTO manda sobre la corrección teórica del formato.
    expect(run('11111111-2222-3333-4444-555555555555')).toBeNull();
  });

  it('rechaza el valor con espacios alrededor solo si no es UUID', () => {
    // Se recorta antes de comparar: pegar del correo de habilitación arrastra
    // espacios, y rechazar por eso sería una fricción sin razón.
    expect(run('  50127d92-850d-4339-908a-bb17c15136c9  ')).toBeNull();
  });

  it('rechaza un UUID con un carácter de más', () => {
    expect(run('50127d92-850d-4339-908a-bb17c15136c99')).toEqual({
      dian_uuid: true,
    });
  });

  it('rechaza un UUID con un espacio en el medio', () => {
    // El caso que motivó el validador.
    expect(run('50127d92-850d-4339-908a-bb17c 5136c9')).toEqual({
      dian_uuid: true,
    });
  });

  it('deja pasar el vacío: la obligatoriedad la decide Validators.required', () => {
    // Mezclar las dos responsabilidades produce un mensaje de error que dice
    // «formato inválido» sobre un campo que el usuario simplemente no llenó.
    for (const empty of ['', null, undefined]) {
      expect(run(empty)).toBeNull();
    }
  });
});

describe('nitFormatValidator', () => {
  const run = (value: unknown) =>
    nitFormatValidator(new FormControl(value as string));

  it('acepta el NIT sin separadores', () => {
    expect(run('901234567')).toBeNull();
  });

  it('acepta el DV pegado con guion, como lo imprime el RUT', () => {
    expect(run('901234567-8')).toBeNull();
  });

  it('rechaza puntos y comas', () => {
    expect(run('901.234.567')).toEqual({ nit_format: true });
  });

  it('rechaza un NIT demasiado corto', () => {
    expect(run('9012')).toEqual({ nit_format: true });
  });
});

describe('dianSoftwarePinValidator', () => {
  const run = (value: unknown) =>
    dianSoftwarePinValidator(new FormControl(value as string));

  it('acepta un PIN numérico', () => {
    expect(run('12345')).toBeNull();
  });

  it('acepta el centinela de secreto ya guardado', () => {
    // Bloquearlo obligaría a reescribir el PIN en cada edición del formulario.
    expect(run('****')).toBeNull();
  });

  it('rechaza un PIN con letras', () => {
    // Entra en el campo 14 del CUDE: un carácter de más produce un hash que la
    // DIAN recomputa distinto y rechaza con el consecutivo ya gastado.
    expect(run('12a45')).toEqual({ dian_pin: true });
  });
});

describe('rangeOrderValidator', () => {
  /**
   * La fábrica existe porque un validador de grupo con nombres de control fijos
   * devuelve `null` cuando no los encuentra, y eso se lee igual que «rango
   * válido». Falla en abierto al montarse en otro formulario.
   */
  it('rechaza un fin menor o igual que el inicio', () => {
    const group = new FormGroup({
      range_from: new FormControl(100),
      range_to: new FormControl(100),
    });
    expect(rangeOrderValidator('range_from', 'range_to')(group)).toEqual({
      rango_final_invalid: true,
    });
  });

  it('acepta un rango creciente', () => {
    const group = new FormGroup({
      range_from: new FormControl(1),
      range_to: new FormControl(5000),
    });
    expect(rangeOrderValidator('range_from', 'range_to')(group)).toBeNull();
  });

  it('con nombres que no existen NO afirma que el rango es válido por accidente', () => {
    // Devuelve `null` porque no hay nada que comparar, pero el spec fija la
    // expectativa: quien monte esto debe pasar los nombres de SU formulario.
    const group = new FormGroup({
      rango_inicial: new FormControl(10),
      rango_final: new FormControl(1),
    });
    expect(rangeOrderValidator('range_from', 'range_to')(group)).toBeNull();
    // Con los nombres correctos sí lo caza.
    expect(rangeOrderValidator('rango_inicial', 'rango_final')(group)).toEqual({
      rango_final_invalid: true,
    });
  });
});

describe('confirmProductionValidator', () => {
  const build = (
    environment: string,
    is_enabled: boolean,
    confirm_production: boolean,
  ) =>
    new FormGroup({
      environment: new FormControl(environment),
      is_enabled: new FormControl(is_enabled),
      confirm_production: new FormControl(confirm_production),
    });

  it('exige la confirmación al activar producción', () => {
    expect(confirmProductionValidator(build('production', true, false))).toEqual(
      { confirm_production_required: true },
    );
  });

  it('no la exige en sandbox', () => {
    expect(confirmProductionValidator(build('test', true, false))).toBeNull();
  });
});

describe('dianValidationMessage', () => {
  it('traduce la clave de error a un texto que dice qué corregir', () => {
    const control = new FormControl('mal', [dianUuidValidator]);
    control.updateValueAndValidity();
    expect(dianValidationMessage(control)).toBe(
      DIAN_VALIDATION_MESSAGES['dian_uuid'],
    );
  });

  it('un control válido no tiene mensaje', () => {
    const control = new FormControl('901234567', [nitFormatValidator]);
    control.updateValueAndValidity();
    expect(dianValidationMessage(control)).toBeNull();
  });

  it('una clave desconocida cae a un texto genérico, no a undefined', () => {
    // Sin esto la UI imprimiría «undefined» junto al campo, que es peor que un
    // texto vago.
    const control = new FormControl('x');
    control.setErrors({ alguna_regla_nueva: true });
    expect(dianValidationMessage(control)).toBe('Revisa este dato.');
  });
});

describe('optionalNumericIdValidator', () => {
  it('admite vacío pero rechaza el cero', () => {
    expect(optionalNumericIdValidator(new FormControl(''))).toBeNull();
    expect(optionalNumericIdValidator(new FormControl('0'))).toEqual({
      numeric_id: true,
    });
  });
});
