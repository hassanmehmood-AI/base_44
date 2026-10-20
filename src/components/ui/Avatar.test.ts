import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withTrackedUrl,
  withLoaded,
  withFailed,
  decideOnImageError,
  MAX_RETRY_ATTEMPTS,
  type AvatarImageState,
} from "./Avatar";

// Regression coverage for the disappearing-avatar bug: Avatar's loaded/failed
// state used to live in two separate useState calls that were never reset
// when `imageUrl` changed, so once an image failed once (e.g. an expired
// Metricool/Facebook signed URL), the row was stuck on initials forever even
// after a later refresh supplied a brand-new, valid URL. withTrackedUrl is
// the fix: it re-points state at the new URL and resets loaded/failed/attempt,
// called unconditionally on every render and guarded to no-op when the URL
// hasn't actually changed.
//
// Second regression (the "flicker" bug): a PERMANENTLY stored avatar's url
// never changes between page loads, so without a retry budget, a single
// one-off transient failure on any ONE of the several independent <img>
// instances showing the exact same url (Social Media inbox row, chat
// header, profile card) would stay stuck on initials for that instance's
// entire lifetime, even though the other instances (or a later refresh)
// might succeed. decideOnImageError is the fix: a bounded number of retries
// before finally giving up, so a transient hiccup self-heals instead of
// looking randomly "sticky" per instance.

test("withTrackedUrl: same url is a no-op — returns the exact same state object", () => {
  const state: AvatarImageState = { url: "https://example.com/a.jpg", loaded: true, failed: false, attempt: 0 };
  const next = withTrackedUrl(state, "https://example.com/a.jpg");
  assert.equal(next, state);
});

test("withTrackedUrl: a different url resets loaded/failed/attempt, even if the prior state had loaded successfully", () => {
  const state: AvatarImageState = { url: "https://example.com/old.jpg", loaded: true, failed: false, attempt: 0 };
  const next = withTrackedUrl(state, "https://example.com/new.jpg");
  assert.deepEqual(next, { url: "https://example.com/new.jpg", loaded: false, failed: false, attempt: 0 });
});

test("withTrackedUrl: recovery — a new url after a failure clears `failed` so the image is retried", () => {
  const failedState: AvatarImageState = { url: "https://example.com/expired.jpg", loaded: false, failed: true, attempt: 2 };
  const next = withTrackedUrl(failedState, "https://example.com/fresh.jpg");
  assert.equal(next.failed, false);
  assert.equal(next.loaded, false);
  assert.equal(next.attempt, 0);
  assert.equal(next.url, "https://example.com/fresh.jpg");
});

test("withTrackedUrl: switching to a different customer's conversation resets the retry budget, not just loaded/failed", () => {
  // Mid-retry (attempt 1 of MAX_RETRY_ATTEMPTS) when the user switches to a
  // different conversation — the new customer's avatar must start with a
  // full, fresh retry budget, never inheriting the previous customer's
  // partially-used one.
  const midRetryState: AvatarImageState = { url: "https://example.com/customer-a.jpg", loaded: false, failed: false, attempt: 1 };
  const next = withTrackedUrl(midRetryState, "https://example.com/customer-b.jpg");
  assert.equal(next.attempt, 0);
});

test("withTrackedUrl: going from a url to null is treated as a url change (resets state, hides the img)", () => {
  const state: AvatarImageState = { url: "https://example.com/a.jpg", loaded: true, failed: false, attempt: 0 };
  const next = withTrackedUrl(state, null);
  assert.deepEqual(next, { url: null, loaded: false, failed: false, attempt: 0 });
});

test("withTrackedUrl: going from null to a url is treated as a url change", () => {
  const state: AvatarImageState = { url: null, loaded: false, failed: false, attempt: 0 };
  const next = withTrackedUrl(state, "https://example.com/a.jpg");
  assert.deepEqual(next, { url: "https://example.com/a.jpg", loaded: false, failed: false, attempt: 0 });
});

test("withTrackedUrl: repeated failure on the SAME url does not spuriously 'recover' — only a url change resets state", () => {
  const failedState: AvatarImageState = { url: "https://example.com/expired.jpg", loaded: false, failed: true, attempt: 2 };
  const next = withTrackedUrl(failedState, "https://example.com/expired.jpg");
  assert.equal(next, failedState);
  assert.equal(next.failed, true);
});

test("withLoaded: marks loaded, preserves url/failed/attempt", () => {
  const state: AvatarImageState = { url: "https://example.com/a.jpg", loaded: false, failed: false, attempt: 1 };
  const next = withLoaded(state);
  assert.deepEqual(next, { url: "https://example.com/a.jpg", loaded: true, failed: false, attempt: 1 });
});

test("withFailed: marks failed, preserves url/loaded/attempt", () => {
  const state: AvatarImageState = { url: "https://example.com/a.jpg", loaded: false, failed: false, attempt: 2 };
  const next = withFailed(state);
  assert.deepEqual(next, { url: "https://example.com/a.jpg", loaded: false, failed: true, attempt: 2 });
});

// --- decideOnImageError: the retry/give-up decision ------------------------

test("decideOnImageError: first failure (attempt 0) retries rather than giving up immediately", () => {
  const decision = decideOnImageError({ url: "https://example.com/a.jpg", loaded: false, failed: false, attempt: 0 });
  assert.deepEqual(decision, { action: "retry", nextAttempt: 1 });
});

test("decideOnImageError: retries up to MAX_RETRY_ATTEMPTS, never beyond — bounded, not infinite", () => {
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    const decision = decideOnImageError({ url: "https://example.com/a.jpg", loaded: false, failed: false, attempt });
    assert.deepEqual(decision, { action: "retry", nextAttempt: attempt + 1 });
  }
  // Once the budget is exhausted, it must give up — never retry a 4th, 5th, etc. time.
  const final = decideOnImageError({ url: "https://example.com/a.jpg", loaded: false, failed: false, attempt: MAX_RETRY_ATTEMPTS });
  assert.deepEqual(final, { action: "giveUp" });
});

test("decideOnImageError: never retries past the budget even if called again after giving up", () => {
  const decision = decideOnImageError({ url: "https://example.com/a.jpg", loaded: false, failed: true, attempt: MAX_RETRY_ATTEMPTS + 5 });
  assert.deepEqual(decision, { action: "giveUp" });
});

// --- Full lifecycles --------------------------------------------------------

test("full lifecycle: load fails for an expired url, then a fresh url arrives and loads successfully", () => {
  let state: AvatarImageState = { url: "https://example.com/expired.jpg", loaded: false, failed: false, attempt: 0 };

  // Image load fails (expired signed URL) and retries exhaust.
  state = withFailed({ ...state, attempt: MAX_RETRY_ATTEMPTS });
  assert.equal(state.failed, true);

  // A later refresh supplies a new, valid url for the same conversation row.
  state = withTrackedUrl(state, "https://example.com/fresh.jpg");
  assert.equal(state.failed, false);
  assert.equal(state.loaded, false);
  assert.equal(state.attempt, 0);

  // The new image loads successfully.
  state = withLoaded(state);
  assert.deepEqual(state, { url: "https://example.com/fresh.jpg", loaded: true, failed: false, attempt: 0 });
});

test("full lifecycle: a transient one-off failure self-heals via retry, without ever showing initials — this is the flicker-bug fix", () => {
  let state: AvatarImageState = { url: "https://example.com/stored-avatar", loaded: false, failed: false, attempt: 0 };

  // First attempt fails (e.g. a transient storage-read blip) — per
  // decideOnImageError, this is a retry, not a give-up, so `failed` must
  // stay false throughout (initials are never shown for a transient hiccup).
  const decision = decideOnImageError(state);
  assert.equal(decision.action, "retry");
  if (decision.action === "retry") state = { ...state, attempt: decision.nextAttempt };
  assert.equal(state.failed, false);

  // The retried request succeeds.
  state = withLoaded(state);
  assert.deepEqual(state, { url: "https://example.com/stored-avatar", loaded: true, failed: false, attempt: 1 });
});

test("full lifecycle: a genuinely persistent failure (e.g. a real 403/404) still correctly falls back to initials after exhausting retries", () => {
  let state: AvatarImageState = { url: "https://example.com/missing-avatar", loaded: false, failed: false, attempt: 0 };

  for (let i = 0; i <= MAX_RETRY_ATTEMPTS; i++) {
    const decision = decideOnImageError(state);
    if (decision.action === "retry") {
      state = { ...state, attempt: decision.nextAttempt };
    } else {
      state = withFailed(state);
    }
  }

  assert.equal(state.failed, true);
});
