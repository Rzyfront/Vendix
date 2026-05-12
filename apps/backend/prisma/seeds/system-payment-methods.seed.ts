import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedSystemPaymentMethodsResult {
  methodsCreated: number;
  methodsSkipped: number;
}

/**
 * DEPENDENCIES: This seed function has no dependencies
 * Can be run independently at any time
 *
 * Creates system-wide payment methods available to all organizations
 */
export async function seedSystemPaymentMethods(
  prisma?: PrismaClient,
): Promise<SeedSystemPaymentMethodsResult> {
  const client = prisma || getPrismaClient();

  const systemMethods = [
    {
      name: 'cash',
      display_name: 'Efectivo',
      description: 'Pago en efectivo en punto de venta',
      type: 'cash',
      provider: 'internal',
      is_active: true,
      requires_config: false,
      supported_currencies: ['USD', 'MXN', 'EUR', 'COP'],
      min_amount: 0,
      processing_mode: 'DIRECT', // Requires physical presence at store
    },
    {
      name: 'stripe_card',
      display_name: 'Tarjeta de Crédito/Débito (Stripe)',
      description: 'Pagos con tarjeta procesados por Stripe',
      type: 'card',
      provider: 'stripe',
      logo_url: 'https://cdn.vendix.com/logos/stripe.png',
      is_active: true,
      requires_config: true,
      config_schema: {
        type: 'object',
        required: ['publishable_key', 'secret_key'],
        properties: {
          publishable_key: {
            type: 'string',
            description: 'Stripe Publishable Key',
          },
          secret_key: {
            type: 'string',
            description: 'Stripe Secret Key',
          },
          webhook_secret: {
            type: 'string',
            description: 'Stripe Webhook Secret',
          },
        },
      },
      supported_currencies: ['USD', 'MXN', 'EUR', 'COP'],
      processing_fee_type: 'percentage',
      processing_fee_value: 2.9,
      processing_mode: 'ONLINE', // Processed via payment gateway
    },
    {
      name: 'paypal',
      display_name: 'PayPal',
      description: 'Pagos a través de PayPal',
      type: 'paypal',
      provider: 'paypal',
      logo_url: 'https://cdn.vendix.com/logos/paypal.png',
      is_active: true,
      requires_config: true,
      config_schema: {
        type: 'object',
        required: ['client_id', 'client_secret'],
        properties: {
          client_id: {
            type: 'string',
            description: 'PayPal Client ID',
          },
          client_secret: {
            type: 'string',
            description: 'PayPal Client Secret',
          },
          mode: {
            type: 'string',
            enum: ['sandbox', 'live'],
            description: 'PayPal Environment Mode',
          },
        },
      },
      supported_currencies: ['USD', 'EUR', 'COP'],
      processing_fee_type: 'percentage',
      processing_fee_value: 3.4,
      processing_mode: 'ONLINE', // Processed via payment gateway
    },
    {
      name: 'bank_transfer',
      display_name: 'Transferencia Bancaria',
      description: 'Pago mediante transferencia bancaria',
      type: 'bank_transfer',
      provider: 'internal',
      is_active: true,
      requires_config: true,
      config_schema: {
        type: 'object',
        required: ['bank_name', 'account_number'],
        properties: {
          bank_name: {
            type: 'string',
            description: 'Nombre del banco',
          },
          account_number: {
            type: 'string',
            description: 'Número de cuenta',
          },
          account_holder: {
            type: 'string',
            description: 'Titular de la cuenta',
          },
          swift_code: {
            type: 'string',
            description: 'Código SWIFT/BIC',
          },
          clabe: {
            type: 'string',
            description: 'CLABE interbancaria (México)',
          },
        },
      },
      supported_currencies: ['USD', 'MXN', 'COP'],
      processing_mode: 'ONLINE', // No physical presence required
    },
    {
      name: 'payment_vouchers',
      display_name: 'Vouchers de Pago',
      description: 'Vouchers o cupones de pago prepagados',
      type: 'voucher',
      provider: 'internal',
      is_active: true,
      requires_config: true,
      config_schema: {
        type: 'object',
        required: ['allow_validation'],
        properties: {
          allow_validation: {
            type: 'boolean',
            description: 'Permitir validación de vouchers',
          },
          require_verification: {
            type: 'boolean',
            description: 'Requerir verificación de vouchers',
          },
          voucher_prefix: {
            type: 'string',
            description: 'Prefijo para códigos de voucher',
          },
          min_amount: {
            type: 'number',
            description: 'Monto mínimo del voucher',
          },
          max_amount: {
            type: 'number',
            description: 'Monto máximo del voucher',
          },
        },
      },
      supported_currencies: ['USD', 'MXN', 'EUR', 'COP'],
      processing_fee_type: 'fixed',
      processing_fee_value: 0,
      processing_mode: 'ONLINE', // Digital vouchers
    },
    {
      name: 'wompi',
      display_name: 'Wompi (Nequi, PSE, Tarjetas, Bancolombia)',
      description: 'Gateway de pagos colombiano. Incluye Nequi, PSE, tarjetas locales y transferencias Bancolombia.',
      type: 'wompi',
      provider: 'wompi',
      is_active: true,
      requires_config: true,
      config_schema: {
        type: 'object',
        required: ['public_key', 'private_key', 'events_secret', 'integrity_secret'],
        properties: {
          public_key: {
            type: 'string',
            title: 'Public Key',
            description: 'Llave pública de Wompi (pub_test_ o pub_prod_)',
          },
          private_key: {
            type: 'string',
            title: 'Private Key',
            description: 'Llave privada de Wompi (prv_test_ o prv_prod_)',
            format: 'password',
          },
          events_secret: {
            type: 'string',
            title: 'Events Secret',
            description: 'Secret para validar webhooks de Wompi',
            format: 'password',
          },
          integrity_secret: {
            type: 'string',
            title: 'Integrity Secret',
            description: 'Secret para firmas de integridad',
            format: 'password',
          },
          environment: {
            type: 'string',
            title: 'Ambiente',
            description: 'Ambiente de Wompi (sandbox para pruebas, production para producción)',
            enum: ['SANDBOX', 'PRODUCTION'],
            default: 'SANDBOX',
          },
        },
      },
      default_config: { environment: 'SANDBOX' },
      supported_currencies: ['COP'],
      processing_fee_type: 'percentage',
      processing_fee_value: 2.99,
      processing_mode: 'ONLINE',
      dian_code: '48',
    },
    {
      name: 'wallet',
      display_name: 'Saldo Wallet (Prepago)',
      description: 'Permite a los clientes pagar con saldo precargado en su wallet interna de la tienda.',
      type: 'wallet',
      provider: 'internal',
      is_active: true,
      requires_config: false,
      supported_currencies: ['COP'],
      processing_mode: 'DIRECT',
      dian_code: '99',
    },
  ];

  let methodsCreated = 0;
  let methodsSkipped = 0;

  for (const method of systemMethods) {
    const existing = await client.system_payment_methods.findUnique({
      where: { name: method.name },
      select: { id: true },
    });

    if (existing) {
      methodsSkipped++;
      continue;
    }

    await client.system_payment_methods.create({
      data: method as any,
    });
    methodsCreated++;
  }

  return {
    methodsCreated,
    methodsSkipped,
  };
}
