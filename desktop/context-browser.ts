import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog, session, WebContentsView } from "electron";
import {
  browserApprovalDomain,
  isAllowedBrowserResource,
  isApprovedBrowserHost
} from "../src/browser-policy";
import type {
  DesktopContextBounds,
  DesktopContextPage,
  DesktopContextSnapshot,
  DesktopContextTab
} from "./contracts";
import { isLoopbackContextUrl, resolveDesktopContextTarget } from "./context-policy";

const MAX_TABS = 8;
const MAX_INCLUDED_TABS = 3;
const MAX_PAGE_TEXT = 12_000;
const MAX_TOTAL_CONTEXT = 24_000;
const CONTEXT_PARTITION = "local-companion-visual-context";

type ManagedTab = DesktopContextTab & { view: WebContentsView; blockedResources: Set<string> };

export class DesktopContextBrowser {
  private readonly tabs = new Map<string, ManagedTab>();
  private readonly approvedDomains = new Set<string>();
  private readonly browserSession = session.fromPartition(CONTEXT_PARTITION, { cache: false });
  private activeTabId?: string;
  private bounds?: DesktopContextBounds;
  private externalAccess = false;

  public constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly onChange: (snapshot: DesktopContextSnapshot) => void
  ) {
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.browserSession.setPermissionCheckHandler(() => false);
    this.browserSession.on("will-download", (event) => event.preventDefault());
    this.browserSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = isAllowedBrowserResource(details.url, this.externalAccess, this.approvedDomains);
      if (!allowed) {
        const tab = [...this.tabs.values()].find((candidate) => candidate.view.webContents.id === details.webContentsId);
        if (tab && isLoopbackContextUrl(tab.url)) {
          try {
            const resource = new URL(details.url);
            if (resource.protocol === "http:" || resource.protocol === "https:") tab.blockedResources.add(resource.hostname);
          } catch {
            // Invalid resources are blocked without being surfaced as trusted context.
          }
        }
      }
      callback({ cancel: !allowed });
    });
  }

  public snapshot(): DesktopContextSnapshot {
    return {
      externalAccess: this.externalAccess,
      activeTabId: this.activeTabId,
      tabs: [...this.tabs.values()].map(({ view: _view, blockedResources: _blockedResources, ...tab }) => ({ ...tab }))
    };
  }

  public setBounds(bounds: DesktopContextBounds): DesktopContextSnapshot {
    const host = this.getWindow();
    if (!host || host.isDestroyed()) return this.snapshot();
    const content = host.getContentBounds();
    this.bounds = {
      x: clampInteger(bounds.x, 0, content.width),
      y: clampInteger(bounds.y, 0, content.height),
      width: clampInteger(bounds.width, 0, content.width),
      height: clampInteger(bounds.height, 0, content.height),
      visible: Boolean(bounds.visible)
    };
    this.layoutViews();
    return this.snapshot();
  }

  public setExternalAccess(enabled: boolean): DesktopContextSnapshot {
    this.externalAccess = enabled;
    if (!enabled) {
      this.approvedDomains.clear();
      for (const tab of [...this.tabs.values()]) {
        if (!isLoopbackContextUrl(tab.url)) this.closeTab(tab.id, false);
      }
    }
    this.publish();
    return this.snapshot();
  }

  public async open(value: string): Promise<DesktopContextSnapshot> {
    if (this.tabs.size >= MAX_TABS) throw new Error(`Feche uma aba antes de abrir outra. O limite é ${MAX_TABS}.`);
    const target = resolveDesktopContextTarget(value);
    if (target.kind !== "local") {
      if (!this.externalAccess) throw new Error("Ative Internet na visão Contexto antes de abrir páginas externas ou pesquisar.");
      if (!await this.ensureExternalDomain(target.url)) throw new Error("A navegação externa foi cancelada.");
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        session: this.browserSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false
      }
    });
    view.setBackgroundColor("#171914");
    const tab: ManagedTab = {
      id,
      kind: target.kind,
      title: target.initialTitle,
      url: target.url,
      status: "loading",
      included: false,
      canGoBack: false,
      canGoForward: false,
      blockedResources: new Set<string>(),
      view
    };
    this.tabs.set(id, tab);
    this.activeTabId = id;
    this.attachView(tab);
    this.configureNavigation(tab);
    this.publish();
    try {
      await view.webContents.loadURL(target.url);
    } catch (error) {
      tab.status = "failed";
      tab.error = singleLineError(error);
      this.publish();
    }
    return this.snapshot();
  }

  public selectTab(id: string): DesktopContextSnapshot {
    if (!this.tabs.has(id)) throw new Error("A aba de contexto não existe mais.");
    this.activeTabId = id;
    this.layoutViews();
    this.publish();
    return this.snapshot();
  }

  public closeTab(id: string, notify = true): DesktopContextSnapshot {
    const tab = this.tabs.get(id);
    if (!tab) return this.snapshot();
    this.getWindow()?.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
    this.tabs.delete(id);
    if (this.activeTabId === id) this.activeTabId = [...this.tabs.keys()].at(-1);
    this.layoutViews();
    if (notify) this.publish();
    return this.snapshot();
  }

  public toggleIncluded(id: string): DesktopContextSnapshot {
    const tab = this.requireTab(id);
    if (!tab.included && [...this.tabs.values()].filter((candidate) => candidate.included).length >= MAX_INCLUDED_TABS) {
      throw new Error(`Use no máximo ${MAX_INCLUDED_TABS} abas como contexto do agente.`);
    }
    tab.included = !tab.included;
    this.publish();
    return this.snapshot();
  }

  public async navigate(action: "back" | "forward" | "reload"): Promise<DesktopContextSnapshot> {
    const tab = this.requireTab(this.activeTabId);
    if (action === "back" && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
    if (action === "forward" && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
    if (action === "reload") tab.view.webContents.reload();
    return this.snapshot();
  }

  public async selectedPages(): Promise<DesktopContextPage[]> {
    const selected = [...this.tabs.values()].filter((tab) => tab.included).slice(0, MAX_INCLUDED_TABS);
    const pages: DesktopContextPage[] = [];
    let remaining = MAX_TOTAL_CONTEXT;
    for (const tab of selected) {
      if (remaining <= 0 || tab.view.webContents.isDestroyed()) break;
      const text = await tab.view.webContents.executeJavaScript(
        `(document.body?.innerText || "").replace(/\\n{3,}/g, "\\n\\n").slice(0, ${Math.min(MAX_PAGE_TEXT, remaining)})`,
        true
      ) as unknown;
      const visibleText = typeof text === "string" ? text.slice(0, Math.min(MAX_PAGE_TEXT, remaining)) : "";
      remaining -= visibleText.length;
      pages.push({ title: tab.title.slice(0, 240), url: tab.url, visibleText });
    }
    return pages;
  }

  public close(): void {
    for (const id of [...this.tabs.keys()]) this.closeTab(id, false);
    this.approvedDomains.clear();
  }

  private attachView(tab: ManagedTab): void {
    const host = this.getWindow();
    if (!host) return;
    host.contentView.addChildView(tab.view);
    this.layoutViews();
  }

  private configureNavigation(tab: ManagedTab): void {
    const contents = tab.view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      void this.approveAndNavigate(tab, url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event) => {
      if (!event.isMainFrame || this.isNavigationAllowed(event.url)) return;
      event.preventDefault();
      void this.approveAndNavigate(tab, event.url);
    });
    contents.on("will-redirect", (event) => {
      if (!event.isMainFrame || this.isNavigationAllowed(event.url)) return;
      event.preventDefault();
      void this.approveAndNavigate(tab, event.url);
    });
    contents.on("did-start-loading", () => {
      tab.blockedResources.clear();
      tab.status = "loading";
      this.publish();
    });
    contents.on("did-stop-loading", () => {
      this.updateTabNavigation(tab);
      if (tab.blockedResources.size) {
        tab.status = "failed";
        tab.error = `O preview depende de recursos externos bloqueados: ${[...tab.blockedResources].sort().join(", ")}. Inclua esses recursos no projeto para manter a execução local.`;
      } else {
        tab.status = "ready";
        tab.error = undefined;
      }
      this.publish();
    });
    contents.on("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      tab.status = "failed";
      tab.url = safeContextUrl(validatedUrl || tab.url);
      tab.error = description.slice(0, 240);
      this.publish();
    });
    contents.on("did-navigate", (_event, url) => {
      tab.url = safeContextUrl(url);
      this.updateTabNavigation(tab);
      this.publish();
    });
    contents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      tab.title = title.trim().slice(0, 120) || new URL(tab.url).hostname;
      this.publish();
    });
  }

  private async approveAndNavigate(tab: ManagedTab, value: string): Promise<void> {
    try {
      const target = resolveDesktopContextTarget(value);
      if (target.kind !== "local" && (!this.externalAccess || !await this.ensureExternalDomain(target.url))) return;
      await tab.view.webContents.loadURL(target.url);
    } catch (error) {
      tab.status = "failed";
      tab.error = singleLineError(error);
      this.publish();
    }
  }

  private async ensureExternalDomain(value: string): Promise<boolean> {
    const url = new URL(value);
    if (isApprovedBrowserHost(url.hostname, this.approvedDomains)) return true;
    const domain = browserApprovalDomain(url.hostname);
    const host = this.getWindow();
    if (!host) return false;
    const result = await dialog.showMessageBox(host, {
      type: "warning",
      title: "Navegação externa",
      message: `Permitir acesso visual a ${domain}?`,
      detail: "A autorização vale apenas nesta sessão. Outros domínios e redirects continuam bloqueados até nova aprovação.",
      buttons: ["Permitir este domínio", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) return false;
    this.approvedDomains.add(domain);
    return true;
  }

  private isNavigationAllowed(value: string): boolean {
    return isAllowedBrowserResource(value, this.externalAccess, this.approvedDomains);
  }

  private updateTabNavigation(tab: ManagedTab): void {
    if (tab.view.webContents.isDestroyed()) return;
    tab.url = safeContextUrl(tab.view.webContents.getURL() || tab.url);
    tab.canGoBack = tab.view.webContents.navigationHistory.canGoBack();
    tab.canGoForward = tab.view.webContents.navigationHistory.canGoForward();
  }

  private layoutViews(): void {
    const host = this.getWindow();
    for (const tab of this.tabs.values()) {
      const active = Boolean(host && this.bounds?.visible && tab.id === this.activeTabId && this.bounds.width > 0 && this.bounds.height > 0);
      tab.view.setVisible(active);
      if (active && this.bounds && host) {
        tab.view.setBounds({ x: this.bounds.x, y: this.bounds.y, width: this.bounds.width, height: this.bounds.height });
        host.contentView.addChildView(tab.view);
      }
    }
  }

  private requireTab(id: string | undefined): ManagedTab {
    const tab = id ? this.tabs.get(id) : undefined;
    if (!tab) throw new Error("Nenhuma aba de contexto está ativa.");
    return tab;
  }

  private publish(): void {
    this.onChange(this.snapshot());
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.round(value) : 0));
}

function safeContextUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString().slice(0, 2_048);
  } catch {
    return "about:blank";
  }
}

function singleLineError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, " ").slice(0, 240);
}
