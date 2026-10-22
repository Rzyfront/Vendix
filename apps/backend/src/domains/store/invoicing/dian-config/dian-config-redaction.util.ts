/**
 * Frontera HTTP de la fila `dian_configurations` (SEC-3, SEC-L1, SEC-L2).
 *
 * Una sola implementación para los tres carriles (tienda, organización y
 * plataforma): tres copias paralelas son la forma en que un carril se queda
 * atrás cuando otro se corrige.
 */

/**
 * Quita `note_phase` de un registro de pruebas/evidencia.
 *
 * `note_phase.deferred[]` guarda cada nota retenida con su XML FIRMADO. Es
 * imprescindible en base y no debe salir en una respuesta HTTP.
 */
export function stripNotePhase<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const { note_phase: _omitted, ...rest } = value as Record<string, any>;
  return rest as T;
}

/**
 * Sanea la fila para la respuesta:
 *  - PIN y contraseña del certificado -> `'****'` / null.
 *  - `enablement_inherited_from_id` (puede ser de OTRA cuenta) ->
 *    `enablement_inherited: boolean`, y se elimina
 *    `enablement_evidence.inheritance.from_dian_configuration_id`.
 *  - `certificate_s3_key` -> `certificate_present`; el ARN de KMS
 *    (`certificate_kms_key_id`) -> `certificate_uses_kms`.
 *  - Sin `note_phase` en `last_test_result` ni en `enablement_evidence`.
 * La columna y la auditoría no se tocan.
 */
export function redactDianConfigForHttp(config: any) {
  const {
    enablement_inherited_from_id,
    certificate_s3_key,
    certificate_kms_key_id,
    ...rest
  } = config;

  const evidence = stripNotePhase(rest.enablement_evidence);
  const inheritance = evidence?.inheritance;
  const public_evidence =
    inheritance && typeof inheritance === 'object'
      ? (() => {
          const { from_dian_configuration_id: _from, ...inheritance_rest } =
            inheritance;
          return { ...evidence, inheritance: inheritance_rest };
        })()
      : evidence;

  return {
    ...rest,
    ...(rest.enablement_evidence !== undefined && {
      enablement_evidence: public_evidence,
    }),
    ...(rest.last_test_result !== undefined && {
      last_test_result: stripNotePhase(rest.last_test_result),
    }),
    enablement_inherited:
      enablement_inherited_from_id !== null &&
      enablement_inherited_from_id !== undefined,
    ...('certificate_s3_key' in config && {
      certificate_present: Boolean(certificate_s3_key),
    }),
    ...('certificate_kms_key_id' in config && {
      certificate_uses_kms: Boolean(certificate_kms_key_id),
    }),
    software_pin_encrypted: config.software_pin_encrypted ? '****' : null,
    certificate_password_encrypted: config.certificate_password_encrypted
      ? '****'
      : null,
  };
}
