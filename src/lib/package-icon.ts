/** The manifest icon must stay within the package root. */
export function isPackageIconPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 2048 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('..') &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(path)
  );
}
