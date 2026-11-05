// Only humanize a simple lower bound. Composer and compound constraints stay
// verbatim so presentation cannot change their meaning.
export function compatibilityLabel(constraint: string): string {
  const minimum = constraint.trim().match(/^>=\s*(\d+(?:\.\d+){0,2})$/);
  return minimum ? `${minimum[1]} or Later` : constraint;
}
