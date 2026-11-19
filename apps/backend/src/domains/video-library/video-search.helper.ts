import { Prisma } from '@prisma/client';
import { tokenizeQuery } from '../../common/helpers/keywords.helper';

/**
 * Search clause shared by the store video library and the Super Admin list.
 * Matches the full phrase or any meaningful word of it (stopwords removed,
 * accent variants included) in title, summary, tags or keywords, so a long
 * or non-literal title query still finds the video. Rank the results with
 * `calculateRelevance` afterwards.
 */
export function buildVideoSearchWhere(search: string): Prisma.videosWhereInput {
  const cleanSearch = search.trim();
  const tokens = tokenizeQuery(cleanSearch);
  return {
    OR: [
      { title: { contains: cleanSearch, mode: 'insensitive' } },
      { summary: { contains: cleanSearch, mode: 'insensitive' } },
      { tags: { has: cleanSearch.toLowerCase() } },
      { keywords: { has: cleanSearch.toLowerCase() } },
      ...tokens.flatMap((t): Prisma.videosWhereInput[] => [
        { title: { contains: t, mode: 'insensitive' } },
        { summary: { contains: t, mode: 'insensitive' } },
        { tags: { has: t } },
        { keywords: { has: t } },
      ]),
    ],
  };
}
