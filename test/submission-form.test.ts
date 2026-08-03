import { describe, expect, it } from 'vitest';
import { buildSubmissionPayload } from '@/lib/submission-form';
import type { DeveloperProfile } from '@/types';

function submissionForm(): FormData {
  const form = new FormData();
  form.set('extension_id', 'example');
  form.set('type', 'mod');
  form.set('name', 'Example');
  form.set('description', 'An example extension.');
  form.set('website', 'example.test');
  form.set('license_name', 'MIT');
  form.set('license_url', 'https://example.test/license');
  form.set('readme', '# Example');
  form.set('source_type', 'github');
  form.set('source_repo', 'fossbilling/example');
  form.set('version_tag', '1.0.0');
  form.set('release_date', '2026-01-01');
  form.set('download_url', 'https://example.test/example.zip');
  form.set('min_fossbilling_version', '0.6.0');
  return form;
}

describe('extension submission payloads', () => {
  it('projects the local developer profile to the v2 submission shape', () => {
    const developer: DeveloperProfile = {
      id: 'developer',
      type: 'organization',
      name: 'Example developer',
      URL: 'https://example.test',
      approved: true,
      contact_email: 'developer@example.test',
      content_revision: 1,
    };

    const payload = buildSubmissionPayload(submissionForm(), developer);

    expect(payload.developer).toEqual({
      id: 'developer',
      type: 'organization',
      name: 'Example developer',
      URL: 'https://example.test',
    });
    expect(payload.developer).not.toHaveProperty('approved');
    expect(payload.developer).not.toHaveProperty('contact_email');
  });
});
