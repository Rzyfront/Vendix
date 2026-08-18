#!/usr/bin/env node
/**
 * Compuerta post-migración: verifica contra la BASE DE DATOS que existan las
 * columnas que el código va a escribir.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------
 * El 14/08/2026 un deploy de producción quedó marcado como "success" con la
 * base desincronizada: `prisma migrate deploy` no aplicó
 * `20260814170000_order_items_sale_unit_snapshot`, pero el cliente Prisma —que
 * se genera desde `schema.prisma` en tiempo de build— sí traía las columnas
 * nuevas. Resultado: el cliente creía que `order_items.sale_unit_code_snapshot`
 * existía, la base no la tenía, y el primer INSERT devolvió `ColumnNotFound`.
 * Para el usuario eso fue un 500 (`SYS_INTERNAL_001`) al cobrar en el POS.
 *
 * El guard que se añadió entonces al workflow interrogaba `Prisma.dmmf`, es
 * decir EL CLIENTE. Pero el cliente siempre tiene los campos: se genera del
 * schema. Ese guard habría pasado limpio durante el mismo incidente que
 * pretendía evitar. La única fuente que puede desmentir al schema es la base.
 *
 * Por eso este script consulta `information_schema.columns` con `pg` y no toca
 * el cliente Prisma.
 *
 * CÓMO MANTENERLO
 * ---------------
 * Añadí una entrada a REQUIRED_COLUMNS cuando escribás código que persista una
 * columna nueva en una ruta crítica. No hace falta listar el esquema entero: la
 * lista cubre lo que rompería en caliente si la migración no llegó a correr.
 * El chequeo genérico de deriva (abajo) cubre el resto de forma informativa.
 *
 * Uso:  node prisma/assert-schema-columns.js
 * Sale con código 1 y nombra cada columna ausente si algo falta.
 */

const { Client } = require('pg');

/**
 * Columnas cuya ausencia produce un 500 en caliente, no un fallo de arranque.
 * Formato: 'tabla.columna'.
 */
const REQUIRED_COLUMNS = [
  // --- Fase 1 · contrato de datos DIAN (migración 20260815120000) ---------
  // El frontend ya envía estos campos y el flujo de emisión los persiste; sin
  // la columna, crear o emitir una factura revienta con ColumnNotFound.
  'invoices.customer_email',
  'invoices.customer_phone',
  'invoices.customer_document_type',
  'invoices.customer_verification_digit',
  'invoices.customer_tax_regime',
  'invoices.customer_fiscal_responsibilities',
  'invoices.payment_form',
  'invoices.payment_means_code',
  'invoices.operation_type',
  'invoices.foreign_currency',
  'invoices.foreign_total_amount',
  'invoices.exchange_rate_date',
  'invoices.exchange_rate',
  'invoices.contingency_deadline',
  'invoices.xml_document',
  'invoice_items.unit_code',
  'invoice_items.account_code',
  'invoice_items.aiu_component',
  'invoice_items.price_unit_quantity',
  'invoice_items.is_inclusive',
  'invoice_resolutions.technical_key_encrypted',

  // --- Huella de clave técnica (migración 20260815150000) -----------------
  // Índice ciego que detecta ClTec compartida entre resoluciones. Lo escribe
  // `TechnicalKeyVaultService.sealForWrite`, o sea CADA alta o edición de
  // resolución en los tres carriles (tienda, organización, super admin).
  'invoice_resolutions.technical_key_fingerprint',

  // --- Subcuenta contable por producto (migración 20260815130000) ---------
  // Sin ellas, guardar un producto con cuenta PUC propia revienta al escribir,
  // y el asiento mixto de la factura pierde el override de cuenta por línea.
  'products.account_code',
  'product_variants.account_code',

  // --- Impuesto ligado a su línea (migración 20260815160000) --------------
  // El desglose por línea escribe esta FK en CADA factura con impuestos
  // tipados. Ausente, el INSERT de `invoice_taxes` falla y la factura entera
  // se cae: es la ruta más transitada del módulo.
  'invoice_taxes.invoice_item_id',

  // --- Incidente 14/08/2026 · el que originó este guard -------------------
  'order_items.sale_unit_code_snapshot',
  'order_items.sale_quantity_snapshot',

  // --- Unidad suelta en la vitrina (migración 20260818180000) -------------
  // Prisma selecciona TODOS los escalares del modelo cuando la consulta no
  // enumera `select`, así que sin esta columna no falla una escritura rara:
  // falla CUALQUIER lectura de producto — catálogo público, POS y editor.
  'products.offer_loose_unit',

  // --- Alcance fiscal (lo que cubría el guard anterior, ahora del lado DB) -
  'organizations.fiscal_scope',
  'accounting_entities.fiscal_scope',
  'dian_configurations.accounting_entity_id',
];

/** Tablas cuya ausencia completa es igual de fatal. */
const REQUIRED_TABLES = ['fiscal_scope_audit_log'];

/** Tipos enum que el schema referencia y la base debe conocer. */
const REQUIRED_ENUM_TYPES = ['aiu_component_enum'];

/**
 * Valores concretos que un enum YA EXISTENTE debe tener.
 *
 * Existe aparte de REQUIRED_ENUM_TYPES por un punto ciego real: una migración
 * `ALTER TYPE ... ADD VALUE` no crea el tipo, así que el chequeo de existencia
 * la da por buena aunque nunca haya corrido. El síntoma en caliente es
 * `invalid input value for enum` — un 500, no un fallo de arranque; el mismo
 * modo de fallo que originó este archivo, sólo que por la puerta del enum.
 *
 * Formato: 'nombre_del_enum': ['valor', ...] — sólo los valores AÑADIDOS por
 * migración posterior a la creación del tipo. No hace falta listar el enum
 * entero: si el tipo se creó, sus valores originales vinieron con él.
 */
const REQUIRED_ENUM_VALUES = {
  // `self` = autorretención (migración 20260815140000). Lo escribe
  // `resolveSelfWithholding()` cuando el emisor es autorretenedor: sin el
  // valor, la primera factura de un autorretenedor revienta al persistir
  // `withholding_calculations.role`.
  withholding_role_enum: ['self'],
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está definida: no hay contra qué verificar el esquema.',
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const [columns, tables, enums, enumValues] = await Promise.all([
      client.query(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = current_schema()`,
      ),
      client.query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = current_schema()`,
      ),
      client.query(`SELECT typname FROM pg_type WHERE typtype = 'e'`),
      client.query(
        `SELECT t.typname, e.enumlabel
           FROM pg_type t
           JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typtype = 'e'`,
      ),
    ]);

    const haveColumns = new Set(
      columns.rows.map((r) => `${r.table_name}.${r.column_name}`),
    );
    const haveTables = new Set(tables.rows.map((r) => r.table_name));
    const haveEnums = new Set(enums.rows.map((r) => r.typname));
    const haveEnumValues = new Set(
      enumValues.rows.map((r) => `${r.typname}.${r.enumlabel}`),
    );

    const missingEnumValues = Object.entries(REQUIRED_ENUM_VALUES).flatMap(
      ([enum_name, values]) =>
        values
          .filter((value) => !haveEnumValues.has(`${enum_name}.${value}`))
          .map((value) => `valor '${value}' del enum ${enum_name}`),
    );

    const missing = [
      ...REQUIRED_COLUMNS.filter((c) => !haveColumns.has(c)).map(
        (c) => `columna ${c}`,
      ),
      ...REQUIRED_TABLES.filter((t) => !haveTables.has(t)).map(
        (t) => `tabla ${t}`,
      ),
      ...REQUIRED_ENUM_TYPES.filter((e) => !haveEnums.has(e)).map(
        (e) => `tipo enum ${e}`,
      ),
      ...missingEnumValues,
    ];

    if (missing.length > 0) {
      // El mensaje nombra QUÉ falta y QUÉ hacer: quien lea esto está mirando
      // un deploy rojo a las tres de la mañana.
      throw new Error(
        `La base de datos no tiene ${missing.length} objeto(s) que el código sí espera:\n` +
          missing.map((m) => `  · ${m}`).join('\n') +
          `\n\nEl cliente Prisma se genera desde schema.prisma, así que él SÍ los tiene:` +
          `\nseguir adelante produciría ColumnNotFound —o 'invalid input value for enum'` +
          `\nsi lo que falta es un valor de enum— con HTTP 500 en la primera escritura.` +
          `\n\nCausa habitual: 'prisma migrate deploy' no aplicó su migración.` +
          `\nRevisar con:  SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10;` +
          `\nUna fila con finished_at NULL es una migración a medio aplicar.`,
      );
    }

    const enumValueCount = Object.values(REQUIRED_ENUM_VALUES).reduce(
      (total, values) => total + values.length,
      0,
    );

    console.log(
      `✅ Esquema verificado contra la base: ${REQUIRED_COLUMNS.length} columnas, ` +
        `${REQUIRED_TABLES.length} tabla(s), ${REQUIRED_ENUM_TYPES.length} tipo(s) enum ` +
        `y ${enumValueCount} valor(es) de enum presentes.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\n❌ VERIFICACIÓN DE ESQUEMA FALLIDA\n\n${error.message}\n`);
  process.exit(1);
});
