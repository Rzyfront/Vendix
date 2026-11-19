import { Prisma } from '@prisma/client';
import { stripAccents, tokenizeQuery } from '../../common/helpers/keywords.helper';

/** Accented lowercase letters folded to plain ones by Postgres `translate()`. */
const ACCENTED = 'áàäâãéèëêíìïîóòöôõúùüûñç';
const PLAIN = 'aaaaaeeeeiiiiooooouuuunc';

/**
 * LIKE patterns, lowercase and without accents, for the full phrase and each
 * meaningful word of it. The full phrase keeps short or partial queries
 * ("como s") working even when every word is a stopword or one letter.
 */
export function buildUnaccentedPatterns(search: string): string[] {
  const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const phrase = stripAccents(search.trim().toLowerCase());
  const words = tokenizeQuery(search).map((t) => stripAccents(t));
  return Array.from(new Set([phrase, ...words]))
    .filter(Boolean)
    .map((term) => `%${escapeLike(term)}%`);
}

/**
 * Tokens to rank results with `calculateRelevance`. When every word is a
 * stopword or one letter ("Como", "como s"), rank by the whole phrase instead
 * of leaving the results unordered.
 */
export function videoRankingTokens(search: string): string[] {
  const tokens = tokenizeQuery(search);
  if (tokens.length) return tokens;
  const phrase = search.trim().toLowerCase();
  return phrase ? [phrase] : [];
}

/**
 * IDs of videos whose title or summary contains the query ignoring accents and
 * case ("como s" finds "Cómo subir…"). Prisma's `contains` is case- but not
 * accent-insensitive, and `unaccent` would need a migration, so this folds
 * accents with the built-in `translate()`.
 */
export async function findVideoIdsIgnoringAccents(
  prisma: { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> },
  search: string,
): Promise<number[]> {
  const patterns = buildUnaccentedPatterns(search);
  if (!patterns.length) return [];
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM videos
    WHERE translate(lower(title), ${ACCENTED}, ${PLAIN}) LIKE ANY(${patterns}::text[])
       OR translate(lower(coalesce(summary, '')), ${ACCENTED}, ${PLAIN}) LIKE ANY(${patterns}::text[])
  `);
  return rows.map((r) => Number(r.id));
}

/**
 * Search clause shared by the store video library and the Super Admin list.
 * Matches the full phrase or any meaningful word of it (stopwords removed,
 * accent variants included) in title, summary, tags or keywords, plus the
 * videos found ignoring accents (`accentInsensitiveIds`), so a long, partial
 * or non-literal title query still finds the video. Rank the results with
 * `calculateRelevance` afterwards.
 */
export function buildVideoSearchWhere(
  search: string,
  accentInsensitiveIds: number[] = [],
): Prisma.videosWhereInput {
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
      ...(accentInsensitiveIds.length ? [{ id: { in: accentInsensitiveIds } }] : []),
    ],
  };
}
