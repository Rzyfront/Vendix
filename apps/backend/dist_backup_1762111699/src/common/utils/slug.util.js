"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSlug = generateSlug;
exports.generateUniqueSlug = generateUniqueSlug;
exports.isValidSlug = isValidSlug;
function generateSlug(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
async function generateUniqueSlug(baseSlug, existingSlugChecker) {
    let slug = baseSlug;
    let counter = 1;
    while (await existingSlugChecker(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
    }
    return slug;
}
function isValidSlug(slug) {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
//# sourceMappingURL=slug.util.js.map