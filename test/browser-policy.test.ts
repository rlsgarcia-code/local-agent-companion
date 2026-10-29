import assert from "node:assert/strict";
import test from "node:test";
import {
  browserLaunchAttempts,
  isAllowedBrowserResource,
  isAllowedLocalBrowserResource,
  normalizeBrowserUrl,
  normalizeLocalBrowserUrl
} from "../src/browser-policy";

test("keeps external browser access explicit, HTTPS-only, and host-scoped", () => {
  assert.equal(normalizeBrowserUrl("https://example.com/docs", true), "https://example.com/docs");
  assert.throws(() => normalizeBrowserUrl("https://example.com", false), /restricted|localhost/);
  assert.throws(() => normalizeBrowserUrl("http://example.com", true), /HTTPS/);
  assert.throws(() => normalizeBrowserUrl("https://127.0.0.1:3000", true), /public host/);
  assert.equal(isAllowedBrowserResource("https://example.com/app.js", true, new Set(["example.com"])), true);
  // Approval is stored at the registrable-domain level so redirects/assets
  // on the same public site do not prompt once per subdomain.
  assert.equal(isAllowedBrowserResource("https://cdn.example.com/app.js", true, new Set(["example.com"])), true);
  assert.equal(isAllowedBrowserResource("https://example.com/app.js", false, new Set(["example.com"])), false);
});

test("accepts only credential-free loopback browser URLs", () => {
  assert.equal(normalizeLocalBrowserUrl("localhost:3000/app"), "http://localhost:3000/app");
  assert.equal(normalizeLocalBrowserUrl("http://0.0.0.0:5173"), "http://127.0.0.1:5173/");
  assert.equal(normalizeLocalBrowserUrl("https://[::1]:8443/status"), "https://[::1]:8443/status");

  for (const url of [
    "https://example.com",
    "http://localhost.example.com:3000",
    "file:///tmp/app.html",
    "http://user:secret@localhost:3000",
    "javascript:alert(1)"
  ]) {
    assert.throws(() => normalizeLocalBrowserUrl(url), /restricted|localhost URL/);
  }
});

test("permits page resources only from loopback or inert in-page schemes", () => {
  for (const url of [
    "about:blank",
    "data:image/png;base64,AA==",
    "blob:http://localhost:3000/abc",
    "http://127.0.0.1:8000/api",
    "ws://localhost:5173/hmr",
    "wss://[::1]:8443/socket"
  ]) {
    assert.equal(isAllowedLocalBrowserResource(url), true, url);
  }
  for (const url of [
    "https://cdn.example.com/app.js",
    "wss://example.com/socket",
    "blob:https://example.com/abc",
    "file:///etc/passwd",
    "http://localhost.example.com"
  ]) {
    assert.equal(isAllowedLocalBrowserResource(url), false, url);
  }
});

test("uses installed Edge first on Windows and never requests a browser download", () => {
  assert.deepEqual(browserLaunchAttempts("auto", undefined, "win32"), [
    { label: "Microsoft Edge", options: { channel: "msedge" } },
    { label: "Google Chrome", options: { channel: "chrome" } }
  ]);
  assert.deepEqual(browserLaunchAttempts("auto", undefined, "darwin"), [
    { label: "Google Chrome", options: { channel: "chrome" } },
    { label: "Microsoft Edge", options: { channel: "msedge" } }
  ]);
  assert.deepEqual(browserLaunchAttempts("chrome", undefined, "win32"), [
    { label: "Google Chrome", options: { channel: "chrome" } }
  ]);
  assert.deepEqual(browserLaunchAttempts("auto", "C:\\Corp\\Browser.exe", "win32"), [
    { label: "configured Chromium browser", options: { executablePath: "C:\\Corp\\Browser.exe" } }
  ]);
});
