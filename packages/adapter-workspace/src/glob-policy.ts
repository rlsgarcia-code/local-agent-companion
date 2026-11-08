const MAX_GLOB_PATTERN_CHARACTERS = 512;
const MAX_GLOB_WILDCARDS = 64;
const MAX_GLOB_SEGMENTS = 64;

/**
 * Bounds model-controlled glob complexity before it reaches filesystem matchers.
 * Brace expansion is intentionally unsupported because the bundled matcher has
 * no patched release for GHSA-vfj7-8cjw-p6xm.
 */
export function validateWorkspaceGlob(value: string): string {
  const pattern = value.trim();
  if (!pattern) throw new Error("Glob pattern cannot be empty.");
  if (pattern.length > MAX_GLOB_PATTERN_CHARACTERS) {
    throw new Error(`Glob pattern exceeds ${MAX_GLOB_PATTERN_CHARACTERS} characters.`);
  }
  if (pattern.includes(String.fromCharCode(0)) || /[\r\n]/.test(pattern)) {
    throw new Error("Glob pattern contains unsupported control characters.");
  }
  if (/[{}]/.test(pattern)) {
    throw new Error("Brace expansion is disabled. Use separate simple glob searches instead.");
  }
  const wildcardCount = [...pattern].filter(
    (character) => character === "*" || character === "?" || character === "["
  ).length;
  if (wildcardCount > MAX_GLOB_WILDCARDS) {
    throw new Error(`Glob pattern exceeds ${MAX_GLOB_WILDCARDS} wildcard operators.`);
  }
  const segmentCount = pattern.split(/[\\/]+/).filter(Boolean).length;
  if (segmentCount > MAX_GLOB_SEGMENTS) {
    throw new Error(`Glob pattern exceeds ${MAX_GLOB_SEGMENTS} path segments.`);
  }
  return pattern;
}

export function isWorkspaceGlob(value: string): boolean {
  try {
    validateWorkspaceGlob(value);
    return true;
  } catch {
    return false;
  }
}
