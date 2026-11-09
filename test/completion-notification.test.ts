import assert from "node:assert/strict";
import test from "node:test";
import {
  completionNotification,
  parseCompletionNotificationMode
} from "../src/completion-notification";

test("defaults unknown completion-notification settings to the quiet hidden-view policy", () => {
  assert.equal(parseCompletionNotificationMode(undefined), "whenHidden");
  assert.equal(parseCompletionNotificationMode("unexpected"), "whenHidden");
  assert.equal(parseCompletionNotificationMode("always"), "always");
});

test("notifies completed and failed background runs without including user content", () => {
  assert.deepEqual(completionNotification("whenHidden", false, "completed"), {
    level: "information",
    message: "Local Agent Companion finished the request.",
    action: "Open result"
  });
  assert.deepEqual(completionNotification("whenHidden", false, "failed"), {
    level: "warning",
    message: "Local Agent Companion needs attention.",
    action: "Open result"
  });
});

test("avoids noise for visible, cancelled, or disabled runs", () => {
  assert.equal(completionNotification("whenHidden", true, "completed"), undefined);
  assert.equal(completionNotification("always", false, "cancelled"), undefined);
  assert.equal(completionNotification("never", false, "failed"), undefined);
  assert.ok(completionNotification("always", true, "completed"));
});

 test("waiting for a durable requirement never announces completion",()=>{assert.equal(completionNotification("always",false,"waiting"),undefined);});
