import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedThreadCollection,
  compactThreadMessages,
  createLocalThread,
  discardUnfinishedRequest,
  MAX_LOCAL_THREADS,
  normalizeThreadCollection,
  stageThreadRequest,
  summarizeThreads,
  titleFromRequest
} from "../src/thread-state";

test("creates a bounded local thread collection from empty state", () => {
  const collection = normalizeThreadCollection(undefined, {
    now: 100,
    createId: () => "thread-new"
  });

  assert.equal(collection.version, 1);
  assert.equal(collection.activeThreadId, "thread-new");
  assert.deepEqual(collection.threads, [createLocalThread("thread-new", 100)]);
});

test("migrates the previous single-conversation projection", () => {
  let id = 0;
  const collection = normalizeThreadCollection({
    id: "legacy-thread",
    messages: [
      { role: "user", content: "Diagnose the workspace build failure" },
      { role: "assistant", content: "I found the failing check." }
    ]
  }, {
    now: 1_000,
    createId: () => `generated-${++id}`
  });

  assert.equal(collection.activeThreadId, "legacy-thread");
  assert.equal(collection.threads[0]?.title, "Diagnose the workspace build failure");
  assert.deepEqual(collection.threads[0]?.messages.map((message) => message.id), [
    "generated-1",
    "generated-2"
  ]);
});

test("summarizes local threads by most recent activity", () => {
  const older = createLocalThread("older", 10, "Older task");
  const newer = createLocalThread("newer", 20, "Newer task");
  newer.messages.push({ id: "message", role: "user", content: "Hello", createdAt: 21 });
  newer.updatedAt = 21;

  assert.deepEqual(summarizeThreads({
    version: 1,
    activeThreadId: "older",
    threads: [older, newer]
  }), [
    { id: "newer", title: "Newer task", updatedAt: 21, messageCount: 1, pinned: false },
    { id: "older", title: "Older task", updatedAt: 10, messageCount: 0, pinned: false }
  ]);
});

test("normalizes and prioritizes pinned conversations without changing activity time", () => {
  const collection = normalizeThreadCollection({
    version: 1,
    activeThreadId: "newer",
    threads: [
      { ...createLocalThread("newer", 20, "Recent work"), pinned: false },
      { ...createLocalThread("pinned", 10, "Important work"), pinned: true }
    ]
  });

  assert.equal(collection.threads.find((thread) => thread.id === "pinned")?.pinned, true);
  assert.equal(collection.threads.find((thread) => thread.id === "newer")?.pinned, undefined);
  assert.deepEqual(summarizeThreads(collection).map((thread) => thread.id), ["pinned", "newer"]);
  assert.equal(summarizeThreads(collection)[0]?.updatedAt, 10);
});

test("normalizes bounded recovery metadata only for an unfinished request", () => {
  const collection = normalizeThreadCollection({
    version: 1,
    activeThreadId: "active",
    threads: [{
      id: "active",
      title: "Interrupted task",
      createdAt: 10,
      updatedAt: 20,
      messages: [{ id: "pending", role: "user", content: "finish this", createdAt: 20 }],
      recovery: {
        id: "run-1",
        status: "interrupted",
        mode: "execute",
        runtime: "deep",
        startedAt: 15,
        updatedAt: 20,
        ownerSessionId: "stale-owner",
        ownerPid: 123
      }
    }]
  });

  assert.deepEqual(collection.threads[0]?.recovery, {
    id: "run-1",
    status: "interrupted",
    mode: "execute",
    runtime: "deep",
    startedAt: 15,
    updatedAt: 20,
    ownerSessionId: "stale-owner",
    ownerPid: 123
  });
  assert.equal(summarizeThreads(collection)[0]?.recoveryStatus, "interrupted");

  collection.threads[0]!.messages.push({ id: "answer", role: "assistant", content: "done", createdAt: 21 });
  const completed = normalizeThreadCollection(collection);
  assert.equal(completed.threads[0]?.recovery, undefined);
});

test("preserves ask-first recovery mode for an interrupted request", () => {
  const collection = normalizeThreadCollection({
    version: 1,
    activeThreadId: "active",
    threads: [{
      id: "active",
      title: "Reviewed task",
      createdAt: 10,
      updatedAt: 20,
      messages: [{ id: "pending", role: "user", content: "finish safely", createdAt: 20 }],
      recovery: {
        id: "run-review",
        status: "interrupted",
        mode: "review",
        runtime: "standard",
        startedAt: 15,
        updatedAt: 20
      }
    }]
  });

  assert.equal(collection.threads[0]?.recovery?.mode, "review");
});

test("preserves a bounded partial assistant response for interrupted-run recovery", () => {
  const collection = normalizeThreadCollection({
    version: 1,
    activeThreadId: "active",
    threads: [{
      id: "active",
      title: "Streaming task",
      createdAt: 10,
      updatedAt: 30,
      messages: [{ id: "pending", role: "user", content: "keep going", createdAt: 20 }],
      recovery: {
        id: "run-stream",
        status: "interrupted",
        mode: "review",
        runtime: "standard",
        startedAt: 21,
        updatedAt: 30,
        partialAssistant: {
          id: "assistant-stream",
          content: "I inspected the relevant files and",
          createdAt: 22,
          updatedAt: 29,
          sequence: 17
        }
      }
    }]
  });

  assert.deepEqual(collection.threads[0]?.recovery?.partialAssistant, {
    id: "assistant-stream",
    content: "I inspected the relevant files and",
    createdAt: 22,
    updatedAt: 29,
    sequence: 17
  });
});

test("replaces an unfinished failed request when a new follow-up is typed", () => {
  const thread = createLocalThread("active", 10, "Review");
  thread.messages.push(
    { id: "previous-user", role: "user", content: "Review the code", createdAt: 20 },
    { id: "completed-assistant", role: "assistant", content: "I found two issues.", createdAt: 21 },
    { id: "failed-user", role: "user", content: "Apply the fixes", createdAt: 22 }
  );
  thread.recovery = {
    id: "run-failed",
    status: "failed",
    mode: "execute",
    runtime: "deep",
    startedAt: 22,
    updatedAt: 23
  };

  const prior = stageThreadRequest(thread, "Now update the tests", {
    now: 30,
    createId: () => "new-user"
  });

  assert.deepEqual(prior.map((message) => message.content), [
    "Review the code",
    "I found two issues."
  ]);
  assert.deepEqual(thread.messages.map((message) => message.content), [
    "Review the code",
    "I found two issues.",
    "Now update the tests"
  ]);
});

test("normalizes stable run metadata on completed assistant messages", () => {
  const collection = normalizeThreadCollection({
    version: 1,
    activeThreadId: "active",
    threads: [{
      id: "active",
      title: "Completed task",
      createdAt: 10,
      updatedAt: 30,
      messages: [
        { id: "user", role: "user", content: "finish", createdAt: 20 },
        {
          id: "assistant",
          role: "assistant",
          content: "done",
          createdAt: 21,
          completedAt: 30,
          runId: "run-complete",
          status: "complete"
        }
      ]
    }]
  });

  assert.deepEqual(collection.threads[0]?.messages[1], {
    id: "assistant",
    role: "assistant",
    content: "done",
    createdAt: 21,
    completedAt: 30,
    runId: "run-complete",
    status: "complete"
  });
});

test("keeps storage bounded while retaining the active thread", () => {
  const threads = Array.from({ length: MAX_LOCAL_THREADS + 5 }, (_, index) =>
    createLocalThread(`thread-${index}`, index, `Thread ${index}`)
  );
  const collection = boundedThreadCollection({
    version: 1,
    activeThreadId: "thread-0",
    threads
  });

  assert.equal(collection.threads.length, MAX_LOCAL_THREADS);
  assert.ok(collection.threads.some((thread) => thread.id === "thread-0"));
  assert.equal(collection.activeThreadId, "thread-0");
});

test("retains pinned conversations ahead of more recent unpinned overflow", () => {
  const threads = Array.from({ length: MAX_LOCAL_THREADS + 2 }, (_, index) =>
    createLocalThread(`thread-${index}`, index, `Thread ${index}`)
  );
  threads[0]!.pinned = true;
  const collection = boundedThreadCollection({
    version: 1,
    activeThreadId: `thread-${MAX_LOCAL_THREADS + 1}`,
    threads
  });

  assert.equal(collection.threads.length, MAX_LOCAL_THREADS);
  assert.ok(collection.threads.some((thread) => thread.id === "thread-0"));
  assert.ok(collection.threads.some((thread) => thread.id === `thread-${MAX_LOCAL_THREADS + 1}`));
});

test("derives compact thread titles from the first request", () => {
  assert.equal(titleFromRequest("  Fix   the tests\nwithout changing behavior  "), "Fix the tests without changing behavior");
  assert.equal(titleFromRequest("123456789", 6), "12345…");
  assert.equal(titleFromRequest(""), "New thread");
});

test("stages a new request while returning the prior conversation", () => {
  const thread = createLocalThread("thread", 1);
  thread.messages.push({ id: "old", role: "user", content: "old request", createdAt: 2 });

  const prior = stageThreadRequest(thread, "new request", {
    now: 3,
    createId: () => "new"
  });

  assert.deepEqual(prior.map((message) => message.id), ["old"]);
  assert.equal(thread.messages.at(-1)?.id, "new");
  assert.equal(thread.messages.at(-1)?.content, "new request");
  assert.equal(thread.updatedAt, 3);
});

test("replaces an unfinished request without duplicating it", () => {
  const thread = createLocalThread("thread", 1);
  thread.messages.push(
    { id: "u1", role: "user", content: "first", createdAt: 2 },
    { id: "a1", role: "assistant", content: "answer", createdAt: 3 },
    { id: "pending", role: "user", content: "failed", createdAt: 4 }
  );

  const prior = stageThreadRequest(thread, "edited request", {
    now: 5,
    replacePendingUser: true
  });

  assert.deepEqual(prior.map((message) => message.id), ["u1", "a1"]);
  assert.equal(thread.messages.length, 3);
  assert.equal(thread.messages.at(-1)?.id, "pending");
  assert.equal(thread.messages.at(-1)?.content, "edited request");
  assert.equal(thread.messages.at(-1)?.createdAt, 5);
});

test("rejects retry when the thread has no unfinished request", () => {
  const thread = createLocalThread("thread", 1);
  thread.messages.push({ id: "answer", role: "assistant", content: "done", createdAt: 2 });

  assert.throws(
    () => stageThreadRequest(thread, "retry", { replacePendingUser: true }),
    /no unfinished request/i
  );
});

test("discards only the unfinished request and preserves completed turns", () => {
  const thread = createLocalThread("thread", 1, "Original task");
  thread.messages.push(
    { id: "u1", role: "user", content: "first", createdAt: 2 },
    { id: "a1", role: "assistant", content: "answer", createdAt: 3 },
    { id: "pending", role: "user", content: "unfinished", createdAt: 4 }
  );
  thread.recovery = {
    id: "run-1",
    status: "interrupted",
    mode: "review",
    runtime: "standard",
    startedAt: 4,
    updatedAt: 4
  };

  const removed = discardUnfinishedRequest(thread, 5);

  assert.equal(removed.id, "pending");
  assert.deepEqual(thread.messages.map((message) => message.id), ["u1", "a1"]);
  assert.equal(thread.recovery, undefined);
  assert.equal(thread.title, "Original task");
  assert.equal(thread.updatedAt, 5);
});

test("resets an empty thread after discard and refuses active or completed requests", () => {
  const pending = createLocalThread("pending", 1, "Only unfinished request");
  pending.messages.push({ id: "u1", role: "user", content: "unfinished", createdAt: 2 });
  discardUnfinishedRequest(pending, 3);
  assert.equal(pending.title, "New thread");
  assert.deepEqual(pending.messages, []);

  const running = createLocalThread("running", 1);
  running.messages.push({ id: "u2", role: "user", content: "active", createdAt: 2 });
  running.recovery = {
    id: "run-2",
    status: "running",
    mode: "review",
    runtime: "standard",
    startedAt: 2,
    updatedAt: 2
  };
  assert.throws(() => discardUnfinishedRequest(running), /still running/i);

  const completed = createLocalThread("completed", 1);
  completed.messages.push({ id: "a1", role: "assistant", content: "done", createdAt: 2 });
  assert.throws(() => discardUnfinishedRequest(completed), /no unfinished request/i);
});

test("compacts whole recent turns without leaving an orphan assistant message", () => {
  const messages = [
    { id: "u1", role: "user" as const, content: "old question", createdAt: 1 },
    { id: "a1", role: "assistant" as const, content: "old answer", createdAt: 2 },
    { id: "u2", role: "user" as const, content: "new question", createdAt: 3 },
    { id: "a2", role: "assistant" as const, content: "new answer", createdAt: 4 }
  ];

  assert.deepEqual(compactThreadMessages(messages, 24), messages.slice(2));
  assert.equal(compactThreadMessages(messages, 24)[0]?.role, "user");
});

test("retains a safely truncated latest turn when it exceeds the context budget", () => {
  const messages = [
    { id: "u", role: "user" as const, content: "u".repeat(100), createdAt: 1 },
    { id: "a", role: "assistant" as const, content: "a".repeat(100), createdAt: 2 }
  ];
  const compacted = compactThreadMessages(messages, 40);

  assert.equal(compacted.length, 2);
  assert.equal(compacted[0]?.role, "user");
  assert.ok(compacted.reduce((sum, message) => sum + message.content.length, 0) <= 40);
  assert.match(compacted[0]?.content ?? "", /…$/);
});
