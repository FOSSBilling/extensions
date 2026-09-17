import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/lib/markdown';

describe('renderMarkdown', () => {
  it('renders headings, emphasis, and lists', () => {
    const html = renderMarkdown(
      '# Title\n\nSome **bold** and *italic*.\n\n- one\n- two',
    );

    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<ul>');
  });

  it('renders links with http(s) schemes', () => {
    const html = renderMarkdown('[site](https://example.test/page)');

    expect(html).toContain('href="https://example.test/page"');
  });

  it('strips script tags and javascript: URLs from untrusted author content', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n[click](javascript:alert(1))',
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
  });

  it('renders empty input to an empty string', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
