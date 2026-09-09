export function isUniqueViolation(error: unknown): boolean {
  // Drizzle >=0.44 wraps driver errors in DrizzleQueryError, exposing the
  // original pg DatabaseError via `cause`; older versions throw it directly.
  let current = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}