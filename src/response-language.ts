export type ResponseLanguage = "pt-BR" | "en";

export function parseResponseLanguage(value: unknown): ResponseLanguage {
  return value === "en" ? "en" : "pt-BR";
}

export function responseLanguageInstruction(language: ResponseLanguage): string {
  return language === "en"
    ? "Reply exclusively in English. Do not switch languages or mix English with Portuguese, except for code, identifiers, command names, and exact quoted text."
    : "Responda exclusivamente em português do Brasil. Não alterne nem misture inglês com português, exceto em código, identificadores, nomes de comandos e trechos citados literalmente.";
}
