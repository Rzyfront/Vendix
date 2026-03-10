import { Test, TestingModule } from '@nestjs/testing';
import { CommentsService } from './comments.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('CommentsService', () => {
  let service: CommentsService;

  const mockPrismaService = {
    support_comments: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    support_tickets: {
      findUnique: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    organizations: {
      findUnique: jest.fn(),
    },
  };

  const mockS3Service = {
    uploadBase64: jest.fn(),
  };

  const mockS3PathHelper = {
    buildSupportPath: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: OrganizationPrismaService, useValue: mockPrismaService },
        { provide: S3Service, useValue: mockS3Service },
        { provide: S3PathHelper, useValue: mockS3PathHelper },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('delete', () => {
    it('should delete a comment successfully when organization matches', async () => {
      const commentId = 1;
      const organizationId = 10;

      mockPrismaService.support_comments.findUnique.mockResolvedValue({
        id: commentId,
        ticket_id: 5,
        ticket: { organization_id: organizationId },
      });
      mockPrismaService.support_comments.delete.mockResolvedValue({});

      const result = await service.delete(commentId, organizationId);

      expect(result).toEqual({ success: true, message: 'Comment deleted successfully' });
      expect(mockPrismaService.support_comments.findUnique).toHaveBeenCalledWith({
        where: { id: commentId },
        include: { ticket: { select: { organization_id: true } } },
      });
      expect(mockPrismaService.support_comments.delete).toHaveBeenCalledWith({
        where: { id: commentId },
      });
    });

    it('should throw NotFoundException when comment does not exist', async () => {
      mockPrismaService.support_comments.findUnique.mockResolvedValue(null);

      await expect(service.delete(999, 10)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when comment belongs to a different organization', async () => {
      const commentId = 1;
      const userOrgId = 10;
      const commentOrgId = 20;

      mockPrismaService.support_comments.findUnique.mockResolvedValue({
        id: commentId,
        ticket_id: 5,
        ticket: { organization_id: commentOrgId },
      });

      await expect(service.delete(commentId, userOrgId)).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.support_comments.delete).not.toHaveBeenCalled();
    });
  });

  describe('findByTicket', () => {
    it('should return comments when organization matches', async () => {
      const ticketId = 5;
      const organizationId = 10;
      const mockComments = [
        { id: 1, content: 'Test comment', ticket_id: ticketId },
      ];

      mockPrismaService.support_tickets.findUnique.mockResolvedValue({
        id: ticketId,
        organization_id: organizationId,
      });
      mockPrismaService.support_comments.findMany.mockResolvedValue(mockComments);

      const result = await service.findByTicket(ticketId, organizationId);

      expect(result).toEqual({ success: true, data: mockComments });
    });

    it('should throw NotFoundException when ticket does not exist', async () => {
      mockPrismaService.support_tickets.findUnique.mockResolvedValue(null);

      await expect(service.findByTicket(999, 10)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when ticket belongs to a different organization', async () => {
      const ticketId = 5;
      const userOrgId = 10;
      const ticketOrgId = 20;

      mockPrismaService.support_tickets.findUnique.mockResolvedValue({
        id: ticketId,
        organization_id: ticketOrgId,
      });

      await expect(service.findByTicket(ticketId, userOrgId)).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.support_comments.findMany).not.toHaveBeenCalled();
    });
  });
});
