import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// The site's single markdown pipeline, so moderators preview exactly what
// the public catalogue renders (see Overview.astro). Readme content is
// untrusted author input rendered in other users' sessions — always sanitize,
// never inject marked output directly.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img',
    'details',
    'summary',
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ['src', 'alt', 'title', 'width', 'height'],
    a: ['href', 'title', 'target', 'rel'],
    '*': ['id', 'class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
};

export function renderMarkdown(source: string): string {
  const rawHtml = marked.parse(source, { async: false });
  return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}
