import { test } from "node:test";
import assert from "node:assert/strict";
import { withTrackedUrl, withLoaded, withFailed, type AvatarImageState } from "./Avatar";

// Regression coverage for the disappearing-avatar bug: Avatar's loaded/failed
// state used to live in two separate useState calls that were never reset
// when `imageUrl` changed, so once an image failed once (e.g. an expired
// Metricool/Facebook signed URL), the row was stuck on initials forever even
// after a later refresh supplied a brand-new, valid URL. withTrackedUrl is
// the fix: it re-points state at the new URL and resets loaded/failed,
// called unconditionally on every render and guarded to no-op when the URL
// hasn't actually changed.

test("withTrackedUrl: same url is a no-op — returns the exact same state object", () => {
  const state: AvatarImageState = { url: "https://example.com/a.jpg", loaded: true, failed: false };
  const next = withTrackedUrl(state, "https://example.com/a.jpg");
  assert.equal(next, state);
});

test("withTrackedUrl: a different url resets loaded/failed, even if the prior state had loaded successfully", () => {
  const state: AvatarImageState = { url: "https://example.com/old.jpg", loaded: true, failed: false };
  const next = withTrackedUrl(state, "https://example.com/new.jpg");
  assert.deepEqual(next, { url: "https://example.com/new.jpg", loaded: false, failed: false });
});

test("withTrackedUrl: recovery — a new url after a failure clears `failed` so the image is retried", () => {
  const failedState: AvatarImageState = { url: "https://example.com/expired.jpg", loaded: false, failed: true };
  const next = withTrackedUrl(failedState, "https://example.com/fresh.jpg");
  assert.equal(next.failed, false);
  assert.equal(next.loaded, false);
  assert.equal(next.url, "https://example.com/fresh.jpg");
});

test("withTrackedUrl: going from a url to null is treated as a url change (resets state, hides the img)", () => {
  const state: AvatarImageState = { url: "https://example.com/a.jpg", loaded: true, failed: false };
  const next = withTrackedUrl(state, null);
  assert.deepEqual(next, { url: null, loaded: false, failed: false });
});

test("withTrackedUrl: going from null to a url is treated as a url change", () => {
  const state: AvatarImageState = { url: null, loaded: false, failed: false };
  const next = withTrackedUrl(state, "https://example.com/a.jpg");
  assert.deepEqual(next, { url: "https://example.com/a.jpg", loaded: false, failed: false });
});

test("withTrackedUrl: repeated failure on the SAME url does not spuriously 'recover' — only a url change resets state", () => {
  const failedState: AvatarImageState = { url: "https://example.com/expired.jpg", loaded: false, failed: true };
  const next = withTrackedUrl(failedState, "https://example.com/expired.jpg");
  assert.equal(next, failedState);
  assert.equal(next.failed, true);
});

test("withLoaded: marks loaded, preserves url and failed", () => {
  const state: AvatarImageState = { url: "https://example.com/a.jpg", loaded: false, failed: false };
  const next = withLoaded(state);
  assert.deepEqual(next, { url: "https://example.com/a.jpg", loaded: true, failed: false });
});

test("withFailed: marks failed, preserves url and loaded", () => {
  const state: AvatarImageState = { url: "https://example.com/a.jpg", loaded: false, failed: false };
  const next = withFailed(state);
  assert.deepEqual(next, { url: "https://example.com/a.jpg", loaded: false, failed: true });
});

test("full lifecycle: load fails for an expired url, then a fresh url arrives and loads successfully", () => {
  let state: AvatarImageState = { url: "https://example.com/expired.jpg", loaded: false, failed: false };

  // Image load fails (expired signed URL).
  state = withFailed(state);
  assert.equal(state.failed, true);

  // A later refresh supplies a new, valid url for the same conversation row.
  state = withTrackedUrl(state, "https://example.com/fresh.jpg");
  assert.equal(state.failed, false);
  assert.equal(state.loaded, false);

  // The new image loads successfully.
  state = withLoaded(state);
  assert.deepEqual(state, { url: "https://example.com/fresh.jpg", loaded: true, failed: false });
});
