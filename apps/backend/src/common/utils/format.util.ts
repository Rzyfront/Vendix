/**
 * Utility functions for formatting text
 */

/**
 * Convert a string to Title Case format
 * Example: "rafael" → "Rafael", "MARÍA" → "María", "john-doe" → "John-Doe"
 * @param text - The text to convert
 * @returns The text in Title Case format
 */
export function toTitleCase(text: string): string {
  if (!text || typeof text !== 'string') {
    return text || '';
  }

  return text
    .toLowerCase()
    .split(' ')
    .map((word) => {
      // Handle hyphens and apostrophes separately
      if (word.includes('-')) {
        return word
          .split('-')
          .map((part) => {
            if (!part) return '';
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
          })
          .join('-');
      }
      if (word.includes("'")) {
        return word
          .split("'")
          .map((part, index) => {
            if (!part) return index === 0 ? '' : "'";
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
          })
          .join("'");
      }

      // Handle words starting with hyphen
      if (word.startsWith('-')) {
        const rest = word.slice(1);
        return '-' + rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
      }

      // Normal case: capitalize first letter, lowercase the rest
      if (!word) return '';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Capitalize only the first letter of a string
 * Example: "rafael" → "Rafael", "rafael peréz" → "Rafael peréz"
 * @param text - The text to capitalize
 * @returns The text with only first letter capitalized
 */
export function capitalize(text: string): string {
  if (!text || typeof text !== 'string') {
    return text || '';
  }

  if (!text.trim()) return '';

  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Validate that a name contains only allowed characters (letters, spaces, hyphens, apostrophes)
 * @param name - The name to validate
 * @returns True if valid, false otherwise
 */
export function isValidName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // Allow: letters, spaces, hyphens, apostrophes
  const name_regex = /^[a-zA-Z\s'-]+$/;
  return name_regex.test(name.trim());
}
