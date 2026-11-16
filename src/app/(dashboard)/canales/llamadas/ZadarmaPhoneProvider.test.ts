import { test } from "node:test";
import assert from "node:assert/strict";
import { mapZadarmaCallStatusMessage } from "./ZadarmaPhoneProvider";

// Pure mapping from Zadarma's real getStatusMessage event names (confirmed
// via static analysis of their public loader-phone-fn.js) to what this
// provider does — no DOM, no network, no React involved.

test("mapZadarmaCallStatusMessage maps a genuinely connected call to 'confirmed'", () => {
  assert.equal(mapZadarmaCallStatusMessage("confirmed"), "confirmed");
});

test("mapZadarmaCallStatusMessage maps a ringing-not-yet-answered call to 'incoming'", () => {
  assert.equal(mapZadarmaCallStatusMessage("incoming"), "incoming");
});

test("mapZadarmaCallStatusMessage maps every call-ended-without-connecting event to 'ended'", () => {
  assert.equal(mapZadarmaCallStatusMessage("canceled"), "ended");
  assert.equal(mapZadarmaCallStatusMessage("rejected"), "ended");
  assert.equal(mapZadarmaCallStatusMessage("busy"), "ended");
});

test("mapZadarmaCallStatusMessage never guesses on 'outgoing' or an unrecognized message — returns null", () => {
  // 'outgoing' fires at dial-time, not connect-time — must NOT be treated
  // as a confirmed connection (this is the exact mismatch that caused the
  // in-app timer to start before any real ringing could have happened).
  assert.equal(mapZadarmaCallStatusMessage("outgoing"), null);
  assert.equal(mapZadarmaCallStatusMessage("some-future-zadarma-event"), null);
  assert.equal(mapZadarmaCallStatusMessage(""), null);
});
