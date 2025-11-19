import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AdminDashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats() {
    // Mock data for now, can be replaced with real aggregation queries later
    const stats = {
      totalOrganizations: 150,
      totalUsers: 4500,
      activeStores: 320,
      platformGrowth: 12.5,
      organizationGrowth: 5,
      userGrowth: 8,
      storeGrowth: 3,
      weeklyData: [
        { week: 'Mon', organizations: 10, users: 50, stores: 5 },
        { week: 'Tue', organizations: 12, users: 60, stores: 7 },
        { week: 'Wed', organizations: 15, users: 55, stores: 6 },
        { week: 'Thu', organizations: 8, users: 45, stores: 4 },
        { week: 'Fri', organizations: 20, users: 80, stores: 10 },
        { week: 'Sat', organizations: 25, users: 90, stores: 12 },
        { week: 'Sun', organizations: 18, users: 70, stores: 8 },
      ],
      recentActivities: [
        {
          id: '1',
          type: 'organization',
          action: 'create',
          description: 'New organization created',
          timestamp: new Date(),
          entityName: 'Acme Corp',
        },
        {
          id: '2',
          type: 'user',
          action: 'register',
          description: 'New user registered',
          timestamp: new Date(Date.now() - 3600000),
          entityName: 'John Doe',
        },
        {
          id: '3',
          type: 'store',
          action: 'create',
          description: 'New store opened',
          timestamp: new Date(Date.now() - 7200000),
          entityName: 'Main St Branch',
        },
      ],
      topOrganizations: [
        {
          id: '1',
          name: 'Tech Solutions Inc',
          stores: 15,
          users: 120,
          revenue: 50000,
          growth: 10,
        },
        {
          id: '2',
          name: 'Retail Group',
          stores: 25,
          users: 200,
          revenue: 75000,
          growth: -2,
        },
        {
          id: '3',
          name: 'Global Trading',
          stores: 8,
          users: 50,
          revenue: 20000,
          growth: 15,
        },
      ],
    };

    return stats;
  }
}
