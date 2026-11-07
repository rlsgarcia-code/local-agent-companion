const REDACTED = "[REDACTED]";

/**
 * Removes credentials from operational text before it is shown, persisted in a
 * run review, or returned to the model as tool output. This deliberately does
 * not run over ordinary user or assistant messages.
 */
export function redactSensitiveText(value: unknown, knownSecrets: readonly string[] = []): string {
  let text = value instanceof Error ? value.message : String(value ?? "");

  for (const secret of [...new Set(knownSecrets.map((item) => item.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length)) {
    text = text.split(secret).join(REDACTED);
  }

  // Private key material must never be useful after redaction, even when a
  // command prints the complete multi-line PEM block.
  text = text.replace(
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gi,
    REDACTED
  );

  // Authentication headers in HTTP errors, debug output, and serialized
  // request objects. Preserve the header name to keep diagnostics useful.
  text = text.replace(
    /\b(authorization\s*[:=]\s*)(?:bearer\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\r\n]+)/gi,
    (_match, prefix: string) => `${prefix}Bearer ${REDACTED}`
  );
  text = text.replace(
    /\b((?:api[-_]?key|x-api-key|ocp-apim-subscription-key)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\r\n]+)/gi,
    (_match, prefix: string) => `${prefix}${REDACTED}`
  );

  // Common JSON, YAML, environment, and log assignments. The name remains so
  // the user can identify which setting is at fault.
  text = text.replace(
    /((?:^|[,{\s])(?:["']?)(?:api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|token|secret|password|passwd)(?:["']?)\s*[:=]\s*)(["']?)([^\s,"'};]+|[^"']*?)(\2)(?=\s*[,;}\r\n]|$)/gim,
    (_match, prefix: string, quote: string) => `${prefix}${quote}${REDACTED}${quote}`
  );

  // URL userinfo and sensitive query parameters can otherwise survive even
  // when the provider has already wrapped the underlying error several times.
  text = text.replace(
    /\b(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi,
    (_match, scheme: string) => `${scheme}${REDACTED}:${REDACTED}@`
  );
  text = text.replace(
    /([?&](?:api[-_]?key|access[-_]?token|token|key|client[-_]?secret|password)=)([^&#\s]*)/gi,
    (_match, prefix: string) => `${prefix}${REDACTED}`
  );

  // Widely used token signatures. These are intentionally conservative and
  // require realistic lengths so ordinary identifiers and code stay readable.
  const tokenPatterns = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
  ];
  for (const pattern of tokenPatterns) text = text.replace(pattern, REDACTED);

  return text;
}

export function safeErrorMessage(error: unknown, knownSecrets: readonly string[] = []): string {
  return redactSensitiveText(error instanceof Error ? error.message : error, knownSecrets);
}
