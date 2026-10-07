import { HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestContextService } from '../../common/context/request-context.service';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { PlatformReceivedBuyerEventQueueQueryDto, ReceivedBuyerEventReviewDto, ReceivedBuyerEventSuspensionDto } from './dto/received-buyer-event-review.dto';
import { SuperAdminReceivedBuyerEventsController } from './super-admin-received-buyer-events.controller';

describe('SuperAdminReceivedBuyerEventsController', () => {
  const target = SuperAdminReceivedBuyerEventsController;

  it('restricts platform actions to super admins and both guards', () => {
    expect(Reflect.getMetadata('path', target)).toBe('super-admin/fiscal/invoicing/received-documents/buyer-event-enablement');
    expect(Reflect.getMetadata('__guards__', target)).toEqual([PermissionsGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, target)).toEqual([UserRole.SUPER_ADMIN]);
  });

  it('uses distinct permissions and explicit 200 statuses for platform review actions', () => {
    const verify = target.prototype.verify;
    const suspend = target.prototype.suspend;
    expect(Reflect.getMetadata('path', verify)).toBe(':organizationId/:accountingEntityId/verify');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, verify)).toEqual(['superadmin:invoicing:received:events:verify']);
    expect(Reflect.getMetadata('__httpCode__', verify)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata('path', suspend)).toBe(':organizationId/:accountingEntityId/suspend');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, suspend)).toEqual(['superadmin:invoicing:received:events:suspend']);
    expect(Reflect.getMetadata('__httpCode__', suspend)).toBe(HttpStatus.OK);
  });

  it('exposes a paginated queue and exact detail behind the read permission', async () => {
    const enablement = { listForPlatform: jest.fn().mockResolvedValue({ items: [{ id: 1 }], total: 1, page: 1, limit: 25 }), getPlatformDetail: jest.fn().mockResolvedValue({ id: 1 }) };
    const responses = { paginated: jest.fn((...args) => args), success: jest.fn((...args) => args) };
    const controller = new target(enablement as any, responses as any);
    const list = target.prototype.list;
    const detail = target.prototype.detail;
    expect(Reflect.getMetadata('path', list)).toBe('/');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, list)).toEqual(['superadmin:invoicing:received:events:read']);
    expect(Reflect.getMetadata('path', detail)).toBe(':organizationId/:accountingEntityId');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, detail)).toEqual(['superadmin:invoicing:received:events:read']);
    const query = { page: 1 } as PlatformReceivedBuyerEventQueueQueryDto;
    await controller.list(query);
    expect(enablement.listForPlatform).toHaveBeenCalledWith(query);
    expect(responses.paginated).toHaveBeenCalledWith([{ id: 1 }], 1, 1, 25, expect.any(String));
    await controller.detail(5, 6);
    expect(enablement.getPlatformDetail).toHaveBeenCalledWith(5, 6);
  });

  it('takes reviewer identity only from authenticated request context', async () => {
    const enablement = {
      verifyAsPlatformReviewer: jest.fn().mockResolvedValue({ status: 'verified' }),
      suspendAsPlatformReviewer: jest.fn().mockResolvedValue({ status: 'suspended' }),
    };
    const responses = { updated: jest.fn((value) => value) };
    const controller = new target(enablement as any, responses as any);
    const userIdSpy = jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(412);
    try {
      const review = { expected_version: 2, verification_source: 'test_set', review_note: 'Reviewed the DIAN production validation evidence.' } as ReceivedBuyerEventReviewDto;
      await controller.verify(5, 6, review);
      expect(enablement.verifyAsPlatformReviewer).toHaveBeenCalledWith(5, 6, 412, review);
      const suspension = { expected_version: 3, reason: 'Suspended after reviewing the reported compliance incident.' } as ReceivedBuyerEventSuspensionDto;
      await controller.suspend(5, 6, suspension);
      expect(enablement.suspendAsPlatformReviewer).toHaveBeenCalledWith(5, 6, 412, suspension);
    } finally {
      userIdSpy.mockRestore();
    }
  });

  it('validates version, source and trimmed bounded review text', async () => {
    const valid = plainToInstance(ReceivedBuyerEventReviewDto, {
      expected_version: '1', verification_source: 'convalidated', review_note: '  This review note is long enough.  ',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.review_note).toBe('This review note is long enough.');
    const invalid = plainToInstance(ReceivedBuyerEventReviewDto, {
      expected_version: 0, verification_source: 'unknown', review_note: ' too short ',
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
    const badSuspension = plainToInstance(ReceivedBuyerEventSuspensionDto, { expected_version: 1, reason: ' short ' });
    expect((await validate(badSuspension)).length).toBeGreaterThan(0);
  });

  it('rejects coerced reviewer values and unknown fields under global pipe semantics', async () => {
    const transformOptions = { enableImplicitConversion: true };
    const validationOptions = { whitelist: true, forbidNonWhitelisted: true };
    const invalidReviewInputs = [
      { expected_version: true, verification_source: 'test_set', review_note: 'A sufficiently long review note.' },
      { expected_version: 1, verification_source: 'test_set', review_note: 42 },
      { expected_version: 1, verification_source: 'test_set', review_note: 'A sufficiently long review note.', reviewer_id: 88 },
    ];
    for (const input of invalidReviewInputs) {
      const dto = plainToInstance(ReceivedBuyerEventReviewDto, input, transformOptions);
      expect((await validate(dto, validationOptions)).length).toBeGreaterThan(0);
    }

    const invalidSuspensionInputs = [
      { expected_version: true, reason: 'A sufficiently long suspension reason.' },
      { expected_version: 1, reason: { text: 'A sufficiently long suspension reason.' } },
      { expected_version: 1, reason: 'A sufficiently long suspension reason.', reviewer_id: 88 },
    ];
    for (const input of invalidSuspensionInputs) {
      const dto = plainToInstance(ReceivedBuyerEventSuspensionDto, input, transformOptions);
      expect((await validate(dto, validationOptions)).length).toBeGreaterThan(0);
    }
  });

  it('validates and transforms bounded queue query values under global pipe semantics', async () => {
    const valid = plainToInstance(PlatformReceivedBuyerEventQueueQueryDto, { page: '2', limit: '20', status: 'verified', search: '  acme  ' }, { enableImplicitConversion: true });
    expect(await validate(valid, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(valid).toMatchObject({ page: 2, limit: 20, status: 'verified', search: 'acme' });
    for (const input of [
      { page: true }, { limit: 101 }, { status: 'not_started' }, { search: 'x'.repeat(101) }, { other: 'x' },
    ]) {
      const dto = plainToInstance(PlatformReceivedBuyerEventQueueQueryDto, input, { enableImplicitConversion: true });
      expect((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
    }
  });
});
