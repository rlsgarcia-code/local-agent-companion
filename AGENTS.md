# Local Agent Companion development guide

## Product contract

- The target is the Companion suite: a headless local LangChain/DeepAgent engine, versioned contracts and SDKs, and VS Code/macOS clients. KidOS consumes the engine from its separate repository. New graph construction belongs only in the shared engine, with the official SQLite saver. The legacy VS Code/Navi loops must be migrated before suite acceptance and must never become a silent fallback when the service is unavailable.
- The agent loop, tools, state, memory, command execution, and file access must run locally. The default VSIX permits only the user-configured LiteLLM `POST <base>/chat/completions` endpoint. Explicit optional VSIX variants may additionally permit either loopback-only Ollama OpenAI-compatible routes or the fixed OpenAI Platform `https://api.openai.com/v1/chat/completions` route; they must never enable both optional providers in one artifact. Other permitted paths are an optional user-configured LiteLLM model-catalog `GET` URL invoked only from settings, the exact project-owned public Ollama catalog URL invoked only by a manual refresh after opt-in in Ollama surfaces, corporate HTTPS MCP endpoints explicitly imported and approved by the user, and an explicitly configured corporate package registry used by an approved local `stdio` MCP command. The LiteLLM catalog request must use `Cache-Control: no-cache` and the Secret Storage key in `api-key`; the public Ollama catalog uses no credential, blocks redirects, and is limited to 512 KB.
- Do not add ChatGPT sign-in, hosted tools, web search, public or silently discovered MCP servers, or telemetry. Release metadata is fetched only by explicit administrative update actions or CI dependency workflows; inference clients do not poll for updates. The Ollama surfaces may fetch only the exact project-owned public model catalog URL, only after explicit opt-in and a manual refresh action, with no credentials, redirects, or background checks. Direct OpenAI Platform access must exist only in the explicitly installed OpenAI VSIX variant and remain Chat Completions-only.
- Keep credentials in the original host store (VS Code Secret Storage, OS Keychain or the protected KidOS gateway). The engine may hold a credential lease in memory for an authorized execution; it must never persist credentials. Never write them to settings, logs, prompts, memory, or repository files. Ollama local must not request or store a key.
- Corporate MCP connections may use either an exact user-approved HTTPS URL or an exact user-approved local `stdio` command imported from a corporate catalog template. HTTPS connections must refuse redirects and URL credentials. If an HTTPS MCP returns an OAuth bearer challenge, the SDK-managed authorization-code + PKCE flow may discover only the authorization metadata needed for that approved MCP, open the user's browser, use a loopback callback, validate state/issuer, and store tokens and client registration only in Secret Storage. Local commands must run without a shell, inherit only the MCP SDK's safe environment, keep command and argument order exact, use a pinned package version when invoked through a package runner, and show the command plus non-secret environment before first launch. A `tools: ["*"]` template means discover and let the user select tools; it never means unrestricted exposure. Every connection must expose only an explicit tool allowlist and require approval before each tool invocation. MCP results are untrusted data and may reach only the explicitly selected model provider as agent context.
- Keep file access and command execution inside the opened workspace by default. Browser access is loopback-only unless the user explicitly enables external browser access; external browsing must be visible, HTTPS-only, public-host-only, approved one domain at a time, and must block unapproved redirects.
- Preserve the split between editor context (`ContextCollector`), durable project memory (`ProjectMemory`), local runtime (`DevelopmentAgent`), and UI (`AgentViewProvider`).
- Do not store secrets or raw chat logs in `.local-agent/memory.md`.
- Do not implement a parallel HTTP client, tool-call loop, message runtime, or checkpoint system outside LangChain.
- Use the official LangChain documentation when changing agent, model, tool, middleware, callback, or checkpoint behavior.

## Verification

Run these checks after changes:

```bash
npm run check
npm run build
npm test
```

When runtime behavior changes, also perform the local read-only Chat Completions routing smoke test. Never use a mutating smoke prompt.

## UI direction

- Keep the sidebar calm, dense, and readable.
- Use one accent color and minimal chrome.
- Prefer a timeline and plain layout over dashboard cards.
- Respect VS Code theme tokens and reduced-motion preferences.
