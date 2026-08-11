/**
 * Clave S3 del certificado `.p12` de una configuración DIAN.
 *
 * FORMA ANTERIOR: `dian/certificates/${config_id}/certificate.p12`.
 *
 * No era un riesgo de colisión —`dian_configurations.id` es único global— sino
 * operativo: mirando el bucket no se puede saber de quién es un certificado, ni
 * purgar los de un tenant cuando se da de baja, ni auditar cuántas identidades
 * fiscales custodiamos por organización. El prefijo pasa a nombrar al dueño.
 *
 * `store_id` nulo ⇔ `organizations.fiscal_scope = 'ORGANIZATION'`: la identidad
 * fiscal está anclada a la organización y no hay tienda titular, así que el
 * segmento se escribe literalmente como `org` en vez de dejar un hueco.
 *
 * SIN MIGRACIÓN Y SIN BACKFILL, A PROPÓSITO. La clave se persiste en
 * `dian_configurations.certificate_s3_key`, que es la única fuente de verdad
 * para leer el archivo: las configuraciones existentes siguen apuntando a su
 * clave vieja y se leen igual. Solo las subidas NUEVAS toman esta forma. Mover
 * los objetos ya almacenados exigiría copiar en S3 y reescribir la columna en
 * la misma transacción; un fallo a mitad dejaría configuraciones apuntando a un
 * objeto inexistente, es decir emisión electrónica caída, a cambio de una
 * mejora puramente organizativa.
 */
export function buildDianCertificateS3Key(params: {
  organization_id: number;
  /** `null` cuando la configuración es de alcance organización. */
  store_id?: number | null;
  dian_configuration_id: number;
}): string {
  const owner = params.store_id ?? 'org';
  return `dian/certificates/org-${params.organization_id}/${owner}/${params.dian_configuration_id}/certificate.p12`;
}
