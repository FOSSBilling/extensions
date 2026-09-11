// FormData.get() is typed as returning `string | null`, but a multipart
// request can put a File under any field name, and File has no .trim() —
// an unchecked cast crashes the request instead of treating it as invalid
// input. Callers that just want "whatever string was submitted, or empty"
// should always go through this rather than casting form.get() directly.
export function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

// Checkboxes submit name=on when checked and are absent when unchecked, so
// presence is the signal. A File under the name counts as present; our forms
// never file-upload a flag field.
export function formFlag(form: FormData, name: string): boolean {
  return form.get(name) !== null;
}
