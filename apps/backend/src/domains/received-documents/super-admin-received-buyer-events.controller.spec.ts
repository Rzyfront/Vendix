import { HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestContextService } from '../../common/context/request-context.service';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { ReceivedBuyerEventReviewDto, ReceivedBuyerEventSuspensionDto } from './dto/received-buyer-event-review.dto';
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
});
