import { test } from "node:test";
import assert from "node:assert/strict";
import { createPgListenerState, onPgListenerConnected } from "./server";

// Regression coverage for the missed-notification fix: Postgres NOTIFY has
// no durability/replay, so a message inserted while this service's own
// LISTEN connection is down is lost forever with no signal to already-
// connected browsers — unless the next successful reconnect tells them to
// resync. The first-ever boot must NOT trigger this (nothing to recover
// from), but every subsequent reconnect must.

test("onPgListenerConnected: the very first connect of a process's lifetime is not a recovery", () => {
  const state = createPgListenerState();
  assert.equal(onPgListenerConnected(state), false);
});

test("onPgListenerConnected: a reconnect after the first connect IS a recovery", () => {
  const state = createPgListenerState();
  onPgListenerConnected(state); // first boot
  assert.equal(onPgListenerConnected(state), true);
});

test("onPgListenerConnected: every subsequent reconnect is independently reported as a recovery, not just the second", () => {
  const state = createPgListenerState();
  onPgListenerConnected(state); // boot
  assert.equal(onPgListenerConnected(state), true); // reconnect 1
  assert.equal(onPgListenerConnected(state), true); // reconnect 2
  assert.equal(onPgListenerConnected(state), true); // reconnect 3
});

test("onPgListenerConnected: state is scoped per instance — a fresh state never carries over a prior instance's history", () => {
  const stateA = createPgListenerState();
  onPgListenerConnected(stateA);
  onPgListenerConnected(stateA);

  const stateB = createPgListenerState();
  assert.equal(onPgListenerConnected(stateB), false);
});
