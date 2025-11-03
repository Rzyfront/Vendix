export declare function generateSlug(text: string): string;
export declare function generateUniqueSlug(baseSlug: string, existingSlugChecker: (slug: string) => Promise<boolean>): Promise<string>;
export declare function isValidSlug(slug: string): boolean;
