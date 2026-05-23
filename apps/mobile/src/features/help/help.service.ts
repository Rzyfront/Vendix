import { apiClient, Endpoints } from '@/core/api';

export interface HelpArticle {
  id: number;
  title: string;
  slug: string;
  summary: string;
  content: string;
  category: {
    id: number;
    name: string;
    slug: string;
  };
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface HelpSearchResponse {
  data: HelpArticle[];
  meta: {
    total: number;
    page: number;
    limit: number;
  };
}

export const HelpCenterService = {
  async searchArticles(query: string, limit: number = 10): Promise<HelpArticle[]> {
    if (!query.trim()) return [];
    const response = await apiClient.get<HelpArticle[]>(`${Endpoints.HELP_CENTER}/articles/search`, {
      params: { q: query, limit },
    });
    return response.data || [];
  },

  async getArticleBySlug(slug: string): Promise<HelpArticle> {
    const response = await apiClient.get<HelpArticle>(`${Endpoints.HELP_CENTER}/articles/${slug}`);
    return response.data;
  },

  async incrementView(id: number): Promise<void> {
    await apiClient.post(`${Endpoints.HELP_CENTER}/articles/${id}/view`);
  },
};
