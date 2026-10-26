import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import * as vscode from "vscode";
import {
  browserLaunchAttempts,
  isAllowedBrowserResource,
  normalizeBrowserUrl,
  type LocalBrowserChannel
} from "./browser-policy";
import type { AgentUiEvent } from "./types";

const MAX_VISIBLE_TEXT = 12_000;
const MAX_CONSOLE_ENTRIES = 30;
const MAX_SCREENSHOT_BYTES = 5_000_000;
const ELEMENT_REFERENCE_ATTRIBUTE = "data-local-companion-ref";

export type LocalBrowserSessionOptions = {
  storageRoot: string;
  channel: LocalBrowserChannel;
  executablePath?: string;
  openPreview: boolean;
  liveMode: boolean;
  externalAccess: boolean;
  approveExternalDomain: (hostname: string) => Promise<boolean>;
  onEvent: (event: AgentUiEvent) => void;
  sanitizeText?: (value: string) => string;
};

export type BrowserSnapshot = {
  url: string;
  title: string;
  visibleText: string;
  elements: Array<{
    ref: string;
    tag: string;
    role?: string;
    name?: string;
    type?: string;
    placeholder?: string;
    disabled: boolean;
  }>;
  console: string[];
  pageErrors: string[];
  blockedRequests: string[];
};

export type BrowserInteraction =
  | { action: "click"; ref: string }
  | { action: "fill"; ref: string; text: string }
  | { action: "press"; ref?: string; key: string }
  | { action: "select"; ref: string; value: string }
  | { action: "reload" }
  | { action: "go_back" }
  | { action: "resize"; width: number; height: number };

export class LocalBrowserSession implements vscode.Disposable {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private approved = false;
  private readonly approvedHosts = new Set<string>();
  private readonly consoleEntries: string[] = [];
  private readonly pageErrors: string[] = [];
  private readonly blockedRequests = new Set<string>();
  private readonly registeredAbortSignals = new WeakSet<AbortSignal>();
  private manualControl = false;
  private readonly artifactDirectory: string;
  private onEvent: (event: AgentUiEvent) => void;
  private sanitizeText: (value: string) => string;

  public constructor(private readonly options: LocalBrowserSessionOptions) {
    this.artifactDirectory = path.join(options.storageRoot, "browser-artifacts");
    this.onEvent = options.onEvent;
    this.sanitizeText = options.sanitizeText ?? ((value) => value);
  }

  public setEventSink(onEvent: (event: AgentUiEvent) => void): void {
    this.onEvent = onEvent;
  }

  public get externalAccess(): boolean {
    return this.options.externalAccess;
  }

  public setSanitizer(sanitizeText: (value: string) => string): void {
    this.sanitizeText = sanitizeText;
  }

  public hasApprovalFor(url: string): boolean {
    const normalized = normalizeBrowserUrl(url, this.options.externalAccess);
    return this.approved && this.approvedHosts.has(new URL(normalized).hostname.toLowerCase());
  }

  public grantApproval(url: string): void {
    this.approved = true;
    this.approvedHosts.add(new URL(normalizeBrowserUrl(url, this.options.externalAccess)).hostname.toLowerCase());
  }

  public async open(url: string, signal: AbortSignal): Promise<BrowserSnapshot> {
    this.bindCancellation(signal);
    const normalizedUrl = normalizeBrowserUrl(url, this.options.externalAccess);
    const hostname = new URL(normalizedUrl).hostname.toLowerCase();
    if (this.options.externalAccess && !this.approvedHosts.has(hostname)) {
      if (!await this.options.approveExternalDomain(hostname)) throw new Error(`The user declined browser access to ${hostname}.`);
      this.approvedHosts.add(hostname);
    }
    if (!this.hasApprovalFor(normalizedUrl)) {
      throw new Error("This localhost browser origin has not been approved by the user.");
    }
    const page = await this.ensurePage(signal);
    this.resetEvidence();
    await abortable(page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }), signal);
    if (this.options.openPreview) {
        await vscode.env.openExternal(vscode.Uri.parse(normalizedUrl));
    }
    this.onEvent({ type: "activity", kind: "browser", title: `Opened ${displayLocalUrl(normalizedUrl)}` });
    return this.snapshot(signal);
  }

  public async snapshot(signal: AbortSignal): Promise<BrowserSnapshot> {
    this.bindCancellation(signal);
    const page = this.requirePage();
    signal.throwIfAborted();
    const snapshot = await abortable(page.evaluate(({ attribute, maximumText }) => {
      for (const element of Array.from(document.querySelectorAll(`[${attribute}]`))) element.removeAttribute(attribute);
      const candidates = [
        ...Array.from(document.querySelectorAll<HTMLElement>(
          "a,button,input,textarea,select,summary,[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='tab'],[tabindex]"
        ))
      ];
      const visible = candidates.filter((element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && bounds.width > 0 && bounds.height > 0;
      }).slice(0, 120);
      const elements = visible.map((element, index) => {
        const ref = `e${index + 1}`;
        element.setAttribute(attribute, ref);
        const input = element instanceof HTMLInputElement ? element : undefined;
        const role = element.getAttribute("role") || undefined;
        const ariaLabel = element.getAttribute("aria-label") || undefined;
        const labelledBy = element.getAttribute("aria-labelledby");
        const labelledText = labelledBy
          ? labelledBy.split(/\s+/).map((id: string) => document.getElementById(id)?.textContent ?? "").join(" ").trim()
          : "";
        const label = input?.labels?.[0]?.textContent?.trim();
        const ownText = element.textContent?.replace(/\s+/g, " ").trim();
        return {
          ref,
          tag: element.tagName.toLowerCase(),
          ...(role ? { role } : {}),
          ...(ariaLabel || labelledText || label || ownText
            ? { name: (ariaLabel || labelledText || label || ownText || "").slice(0, 240) }
            : {}),
          ...(input?.type ? { type: input.type } : {}),
          ...(input?.placeholder ? { placeholder: input.placeholder.slice(0, 240) } : {}),
          disabled: Boolean((element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled)
        };
      });
      return {
        title: document.title,
        visibleText: (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").slice(0, maximumText),
        elements
      };
    }, { attribute: ELEMENT_REFERENCE_ATTRIBUTE, maximumText: MAX_VISIBLE_TEXT }), signal);
    const result: BrowserSnapshot = {
      url: safePageUrl(page.url()),
      title: this.sanitize(snapshot.title),
      visibleText: this.sanitize(snapshot.visibleText),
      elements: snapshot.elements.map((element) => ({
        ...element,
        ...(element.name ? { name: this.sanitize(element.name) } : {}),
        ...(element.placeholder ? { placeholder: this.sanitize(element.placeholder) } : {})
      })),
      console: [...this.consoleEntries],
      pageErrors: [...this.pageErrors],
      blockedRequests: [...this.blockedRequests].slice(-20)
    };
    this.onEvent({
      type: "activity",
      kind: "browser",
      title: `Inspected ${displayLocalUrl(result.url)} · ${result.elements.length} controls`,
      ...(result.pageErrors.length ? { detail: result.pageErrors.join("\n") } : {})
    });
    return result;
  }

  public async interact(input: BrowserInteraction, signal: AbortSignal): Promise<BrowserSnapshot> {
    this.bindCancellation(signal);
    await this.waitForAgentControl(signal);
    const page = this.requirePage();
    signal.throwIfAborted();
    switch (input.action) {
      case "click":
        await abortable(this.locator(input.ref).click({ timeout: 10_000 }), signal);
        break;
      case "fill": {
        const locator = this.locator(input.ref);
        const type = await abortable(locator.getAttribute("type"), signal);
        if (type?.toLowerCase() === "password") {
          throw new Error("The local browser tool does not fill password fields.");
        }
        await abortable(locator.fill(input.text, { timeout: 10_000 }), signal);
        break;
      }
      case "press":
        if (input.ref) await abortable(this.locator(input.ref).press(input.key, { timeout: 10_000 }), signal);
        else await abortable(page.keyboard.press(input.key), signal);
        break;
      case "select":
        await abortable(this.locator(input.ref).selectOption(input.value, { timeout: 10_000 }), signal);
        break;
      case "reload":
        await abortable(page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }), signal);
        break;
      case "go_back":
        await abortable(page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }), signal);
        break;
      case "resize":
        await abortable(page.setViewportSize({ width: input.width, height: input.height }), signal);
        break;
    }
    await page.waitForTimeout(250);
    this.onEvent({ type: "activity", kind: "browser", title: browserInteractionTitle(input) });
    return this.snapshot(signal);
  }

  public setManualControl(enabled: boolean): void {
    this.manualControl = enabled;
    this.onEvent({
      type: "activity",
      kind: "browser",
      title: enabled ? "Browser control handed to user" : "Browser control returned to agent"
    });
  }

  public async screenshot(signal: AbortSignal): Promise<{ bytes: Buffer; mimeType: "image/jpeg" }> {
    this.bindCancellation(signal);
    const page = this.requirePage();
    signal.throwIfAborted();
    const bytes = await abortable(page.screenshot({
      type: "jpeg",
      quality: 82,
      animations: "disabled",
      caret: "hide",
      scale: "css"
    }), signal);
    if (bytes.length > MAX_SCREENSHOT_BYTES) {
      throw new Error(`Browser screenshot exceeded the ${MAX_SCREENSHOT_BYTES} byte safety limit.`);
    }
    await mkdir(this.artifactDirectory, { recursive: true });
    await writeFile(path.join(this.artifactDirectory, "latest.jpg"), bytes);
    this.onEvent({
      type: "activity",
      kind: "browser",
      title: `Captured local viewport · ${Math.ceil(bytes.length / 1024)} KB`
    });
    return { bytes, mimeType: "image/jpeg" };
  }

  public async close(): Promise<void> {
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    this.approved = false;
    this.approvedHosts.clear();
    this.resetEvidence();
    await browser?.close().catch(() => undefined);
    await rm(this.artifactDirectory, { recursive: true, force: true }).catch(() => undefined);
    this.onEvent({ type: "activity", kind: "browser", title: "Closed local browser session" });
  }

  public dispose(): void {
    void this.close();
  }

  private async ensurePage(signal: AbortSignal): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    const browser = await this.launchBrowser(signal);
    const context = await abortable(browser.newContext({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: false,
      serviceWorkers: "block"
    }), signal);
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (isAllowedBrowserResource(requestUrl, this.options.externalAccess, this.approvedHosts)) return route.continue();
      if (this.options.externalAccess && await this.approveRedirectDomain(requestUrl)) return route.continue();
      this.blockedRequests.add(redactedBlockedUrl(requestUrl));
      await route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", async (route) => {
      if (isAllowedBrowserResource(route.url(), this.options.externalAccess, this.approvedHosts)) return route.connectToServer();
      this.blockedRequests.add(redactedBlockedUrl(route.url()));
      await route.close({ code: 1008, reason: this.options.externalAccess ? "External domain was not approved" : "Local Agent Companion permits loopback WebSockets only" });
    });
    context.on("page", (openedPage) => {
      if (this.page && openedPage !== this.page) void openedPage.close().catch(() => undefined);
    });
    const page = await abortable(context.newPage(), signal);
    page.on("console", (message) => {
      if (!["warning", "error"].includes(message.type())) return;
      pushBounded(this.consoleEntries, this.sanitize(`${message.type()}: ${message.text()}`), MAX_CONSOLE_ENTRIES);
    });
    page.on("pageerror", (error) => pushBounded(this.pageErrors, this.sanitize(error.message), MAX_CONSOLE_ENTRIES));
    this.context = context;
    this.page = page;
    return page;
  }

  private async launchBrowser(signal: AbortSignal): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const { chromium } = await import("playwright-core");
    const attempts = browserLaunchAttempts(this.options.channel, this.options.executablePath);
    const errors: string[] = [];
    for (const attempt of attempts) {
      signal.throwIfAborted();
      try {
        const browser = await abortable(chromium.launch({
          headless: !this.options.liveMode,
          chromiumSandbox: true,
          ...attempt.options
        }), signal);
        this.browser = browser;
        browser.on("disconnected", () => {
          if (this.browser === browser) {
            this.browser = undefined;
            this.context = undefined;
            this.page = undefined;
          }
        });
        this.onEvent({ type: "activity", kind: "browser", title: `Started ${attempt.label} locally` });
        return browser;
      } catch (error) {
        errors.push(`${attempt.label}: ${singleLineError(error)}`);
      }
    }
    throw new Error(
      `Could not start an installed Chrome or Edge browser. No browser download or administrator access was attempted. ${errors.join(" | ")}`
    );
  }

  private async approveRedirectDomain(value: string): Promise<boolean> {
    let url: URL;
    try { url = new URL(value); } catch { return false; }
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    if (this.approvedHosts.has(hostname)) return true;
    const approved = await this.options.approveExternalDomain(hostname);
    if (approved) this.approvedHosts.add(hostname);
    return approved;
  }

  private locator(ref: string) {
    if (!/^e(?:[1-9]|[1-9]\d|1[01]\d|120)$/.test(ref)) {
      throw new Error("Browser element reference must come from the latest browser_inspect result.");
    }
    return this.requirePage().locator(`[${ELEMENT_REFERENCE_ATTRIBUTE}="${ref}"]`);
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) throw new Error("Open a localhost page with browser_open before using this tool.");
    return this.page;
  }

  private async waitForAgentControl(signal: AbortSignal): Promise<void> {
    while (this.manualControl) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 250);
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason instanceof Error ? signal.reason : new Error("Browser action was cancelled."));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }

  private resetEvidence(): void {
    this.consoleEntries.length = 0;
    this.pageErrors.length = 0;
    this.blockedRequests.clear();
  }

  private bindCancellation(signal: AbortSignal): void {
    if (this.registeredAbortSignals.has(signal)) return;
    this.registeredAbortSignals.add(signal);
    signal.addEventListener("abort", () => void this.close(), { once: true });
  }

  private sanitize(value: string): string {
    return this.sanitizeText(value);
  }
}

function displayLocalUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 300);
  } catch {
    return "local application";
  }
}

function redactedBlockedUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.slice(0, 300);
  } catch {
    return "non-loopback request";
  }
}

function safePageUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 2_048);
  } catch {
    return "about:blank";
  }
}

function pushBounded(items: string[], value: string, maximum: number): void {
  items.push(value.replace(/[\r\n\t]+/g, " ").slice(0, 1_000));
  if (items.length > maximum) items.splice(0, items.length - maximum);
}

function singleLineError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function browserInteractionTitle(input: BrowserInteraction): string {
  switch (input.action) {
    case "click": return `Clicked ${input.ref}`;
    case "fill": return `Filled ${input.ref}`;
    case "press": return `Pressed ${input.key}${input.ref ? ` on ${input.ref}` : ""}`;
    case "select": return `Selected an option in ${input.ref}`;
    case "reload": return "Reloaded local page";
    case "go_back": return "Navigated back in local page";
    case "resize": return `Resized viewport to ${input.width}×${input.height}`;
  }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Browser action was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
