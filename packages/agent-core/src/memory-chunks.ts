export function memoryChunks(memoryText: string, maximumCharacters = 1_200): string[] {
  const lines = memoryText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line &&
      !line.startsWith("<!--") &&
      !line.startsWith("# Project memory") &&
      line !== "Durable facts, decisions, conventions, and follow-ups for the workspace agent."
    );
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maximumCharacters) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);
  return chunks;
}
