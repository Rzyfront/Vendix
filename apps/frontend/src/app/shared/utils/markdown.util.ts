/**
 * Simple markdown-to-HTML converter for help center content.
 * Supports: headings, bold, italic, lists, images, links, paragraphs.
 */
export function markdownToHtml(md: string): string {
  if (!md) return '';

  return md
    .split('\n')
    .map(line => {
      // Headings
      if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
      // List items
      if (line.startsWith('- ')) return `<li>${inlineMarkdown(line.slice(2))}</li>`;
      if (/^\d+\.\s/.test(line)) return `<li>${inlineMarkdown(line.replace(/^\d+\.\s/, ''))}</li>`;
      // Empty line
      if (line.trim() === '') return '<br>';
      // Paragraph
      return `<p>${inlineMarkdown(line)}</p>`;
    })
    .join('\n')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
}

/**
 * Processes inline markdown: bold, italic, images, links.
 */
function inlineMarkdown(text: string): string {
  return text
    // Images: ![alt](url)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full rounded-lg my-2">')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary-600 hover:underline">$1</a>')
    // Bold: **text**
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic: *text*
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}
