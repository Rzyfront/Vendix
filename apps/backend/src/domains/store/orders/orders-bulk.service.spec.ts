import { Test } from '@nestjs/testing';
import { OrdersBulkService } from './orders-bulk.service';
import { OrderFlowService } from './order-flow/order-flow.service';
import { DispatchNotesService } from '../dispatch-notes/dispatch-notes.service';
import { DispatchRoutesService } from '../dispatch-routes/dispatch-routes.service';
import { SettingsService } from '../settings/settings.service';
import { S3Service } from '@common/services/s3.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';

describe('OrdersBulkService', () => {
  let service: OrdersBulkService;
  let orderFlowService: { forceOrderState: jest.Mock };
  let dispatchNotesService: { createFromOrdersBatch: jest.Mock };
  let dispatchRoutesService: { addStops: jest.Mock };

  beforeEach(async () => {
    orderFlowService = {
      forceOrderState: jest.fn(),
    };
    dispatchNotesService = {
      createFromOrdersBatch: jest.fn(),
    };
    dispatchRoutesService = {
      addStops: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersBulkService,
        { provide: StorePrismaService, useValue: {} },
        { provide: OrderFlowService, useValue: orderFlowService },
        { provide: DispatchNotesService, useValue: dispatchNotesService },
        { provide: DispatchRoutesService, useValue: dispatchRoutesService },
        { provide: SettingsService, useValue: {} },
        { provide: S3Service, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(OrdersBulkService);
  });

  describe('bulkTransition', () => {
    it('calls forceOrderState per id and returns a partial result on mixed outcomes', async () => {
      orderFlowService.forceOrderState
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('kitchen items pending'));

      const result = await service.bulkTransition({
        ids: [1, 2],
        targetState: 'finished',
      } as any);

      expect(orderFlowService.forceOrderState).toHaveBeenCalledTimes(2);
      expect(orderFlowService.forceOrderState).toHaveBeenCalledWith(
        1,
        'finished',
        expect.objectContaining({ reason: expect.any(String) }),
      );

      expect(result.total).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[0]).toEqual({
        id: 1,
        status: 'ok',
        message: expect.stringContaining('finished'),
      });
      expect(result.results[1].status).toBe('error');
      expect(result.results[1].id).toBe(2);
    });

    it('uses a default reason when none is provided', async () => {
      orderFlowService.forceOrderState.mockResolvedValue(undefined);

      const result = await service.bulkTransition({
        ids: [10],
        targetState: 'shipped',
      } as any);

      expect(result.successful).toBe(1);
      expect(orderFlowService.forceOrderState).toHaveBeenCalledWith(
        10,
        'shipped',
        expect.objectContaining({ reason: expect.stringContaining('QUI-599') }),
      );
    });
  });

  describe('bulkAssignRoute', () => {
    it('maps created notes to ok and calls addStops once with all note ids', async () => {
      dispatchNotesService.createFromOrdersBatch.mockResolvedValue({
        results: [
          {
            status: 'created',
            order_id: 1,
            dispatch_note_id: 501,
            dispatch_number: 'DSP-501',
          },
          {
            status: 'created',
            order_id: 2,
            dispatch_note_id: 502,
            dispatch_number: 'DSP-502',
          },
        ],
        partial: false,
      });
      dispatchRoutesService.addStops.mockResolvedValue(undefined);

      const result = await service.bulkAssignRoute({
        ids: [1, 2],
        route_id: 7,
      } as any);

      expect(dispatchNotesService.createFromOrdersBatch).toHaveBeenCalledWith(
        expect.objectContaining({ orders: [1, 2], target_status: 'confirmed' }),
      );
      expect(dispatchRoutesService.addStops).toHaveBeenCalledTimes(1);
      expect(dispatchRoutesService.addStops).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          stops: [
            { dispatch_note_id: 501 },
            { dispatch_note_id: 502 },
          ],
        }),
      );

      expect(result.total).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('reports failed rows when a note creation fails', async () => {
      dispatchNotesService.createFromOrdersBatch.mockResolvedValue({
        results: [
          {
            status: 'failed',
            order_id: 1,
            error_code: 'DSP_ORDER_FAIL',
            message: 'order not found',
          },
          {
            status: 'created',
            order_id: 2,
            dispatch_note_id: 502,
            dispatch_number: 'DSP-502',
          },
        ],
        partial: true,
      });
      dispatchRoutesService.addStops.mockResolvedValue(undefined);

      const result = await service.bulkAssignRoute({
        ids: [1, 2],
        route_id: 7,
      } as any);

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[0].status).toBe('error');
      expect(result.results[1].status).toBe('ok');
    });

    it('warns on ok rows when addStops fails after notes were created', async () => {
      dispatchNotesService.createFromOrdersBatch.mockResolvedValue({
        results: [
          {
            status: 'created',
            order_id: 1,
            dispatch_note_id: 501,
            dispatch_number: 'DSP-501',
          },
        ],
        partial: false,
      });
      dispatchRoutesService.addStops.mockRejectedValue(
        new Error('route not editable'),
      );

      const result = await service.bulkAssignRoute({
        ids: [1],
        route_id: 7,
      } as any);

      expect(result.successful).toBe(1);
      expect(result.results[0].status).toBe('ok');
      expect(result.results[0].message).toContain('ADVERTENCIA');
    });
  });
});