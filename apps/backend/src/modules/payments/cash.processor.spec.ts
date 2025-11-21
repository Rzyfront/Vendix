import { Test, TestingModule } from '@nestjs/testing';
import { CashPaymentProcessor } from './processors/cash/cash.processor';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from './interfaces';
import { payments_state_enum } from '@prisma/client';

describe('CashPaymentProcessor', () => {
  let processor: CashPaymentProcessor;
  const mockConfig = {
    enabled: true,
    testMode: false,
    credentials: {},
    settings: {},
  };

  beforeEach(async () => {
    processor = new CashPaymentProcessor(mockConfig);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('processPayment', () => {
    it('should process cash payment successfully', async () => {
      const paymentData: PaymentData = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const result: PaymentResult = await processor.processPayment(paymentData);

      expect(result.success).toBe(true);
      expect(result.status).toBe(payments_state_enum.succeeded);
      expect(result.transactionId).toBeDefined();
      expect(result.message).toBe('Cash payment processed successfully');
      expect(result.nextAction?.type).toBe('await');
    });

    it('should generate unique transaction IDs', async () => {
      const paymentData: PaymentData = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const result1 = await processor.processPayment(paymentData);
      const result2 = await processor.processPayment(paymentData);

      expect(result1.transactionId).not.toBe(result2.transactionId);
    });
  });

  describe('refundPayment', () => {
    it('should refund cash payment successfully', async () => {
      const result: RefundResult = await processor.refundPayment(
        'txn_1234567890',
        50.0,
      );

      expect(result.success).toBe(true);
      expect(result.amount).toBe(50.0);
      expect(result.status).toBe('succeeded');
      expect(result.refundId).toBeDefined();
      expect(result.message).toBe('Cash refund processed successfully');
    });

    it('should handle refund with default amount', async () => {
      const result: RefundResult =
        await processor.refundPayment('txn_1234567890');

      expect(result.success).toBe(true);
      expect(result.amount).toBe(0);
    });
  });

  describe('validatePayment', () => {
    it('should validate payment data correctly', async () => {
      const validPaymentData: PaymentData = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const result = await processor.validatePayment(validPaymentData);

      expect(result).toBe(true);
    });

    it('should reject invalid payment data', async () => {
      const invalidPaymentData: PaymentData = {
        orderId: 1,
        customerId: 1,
        amount: 0, // Invalid amount
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const result = await processor.validatePayment(invalidPaymentData);

      expect(result).toBe(false);
    });

    it('should reject payment with missing currency', async () => {
      const invalidPaymentData: PaymentData = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: '', // Missing currency
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const result = await processor.validatePayment(invalidPaymentData);

      expect(result).toBe(false);
    });
  });

  describe('getPaymentStatus', () => {
    it('should return payment status', async () => {
      const transactionId = 'txn_1234567890';
      const result: PaymentStatus =
        await processor.getPaymentStatus(transactionId);

      expect(result.status).toBe(payments_state_enum.succeeded);
      expect(result.transactionId).toBe(transactionId);
      expect(result.paidAt).toBeInstanceOf(Date);
    });
  });

  describe('validateWebhook', () => {
    it('should always return true for cash webhooks', async () => {
      const result = await processor.validateWebhook('signature', 'body');

      expect(result).toBe(true);
    });
  });

  describe('isEnabled', () => {
    it('should return enabled status', () => {
      expect(processor.isEnabled()).toBe(true);
    });

    it('should return disabled status when configured', () => {
      const disabledProcessor = new CashPaymentProcessor({
        ...mockConfig,
        enabled: false,
      });

      expect(disabledProcessor.isEnabled()).toBe(false);
    });
  });

  describe('isTestMode', () => {
    it('should return test mode status', () => {
      expect(processor.isTestMode()).toBe(false);
    });

    it('should return test mode when configured', () => {
      const testProcessor = new CashPaymentProcessor({
        ...mockConfig,
        testMode: true,
      });

      expect(testProcessor.isTestMode()).toBe(true);
    });
  });
});
