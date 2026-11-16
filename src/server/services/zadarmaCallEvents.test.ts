import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhoneDigits, phonesMatch, mapDispositionToStatus } from "./zadarmaCallEvents";

// Pure-logic regression coverage — no database or network call is made by
// this suite, same discipline as whatsappJid.test.ts's phone/JID matching
// tests.

test("normalizePhoneDigits strips everything but digits", () => {
  assert.equal(normalizePhoneDigits("+1 (555) 123-4567"), "15551234567");
  assert.equal(normalizePhoneDigits(null), "");
  assert.equal(normalizePhoneDigits(undefined), "");
});

test("phonesMatch: identical numbers in different formats match", () => {
  assert.equal(phonesMatch("+1 555-123-4567", "15551234567"), true);
  assert.equal(phonesMatch("5551234567", "+1 (555) 123-4567"), true);
});

test("phonesMatch: a stored number missing a leading country code still matches by suffix", () => {
  assert.equal(phonesMatch("5551234567", "+15551234567"), true);
});

test("phonesMatch: genuinely different numbers never match", () => {
  assert.equal(phonesMatch("5551234567", "5559999999"), false);
});

test("phonesMatch: never matches on numbers shorter than 7 digits, even if one is a suffix of the other", () => {
  assert.equal(phonesMatch("4567", "5551234567"), false);
  assert.equal(phonesMatch("123", "123"), false);
});

test("phonesMatch: null/undefined never throws, resolves to false", () => {
  assert.equal(phonesMatch(null, "5551234567"), false);
  assert.equal(phonesMatch(undefined, undefined), false);
});

test("mapDispositionToStatus maps every documented disposition value, never guesses on an unrecognized one", () => {
  assert.equal(mapDispositionToStatus("answered"), "COMPLETED");
  assert.equal(mapDispositionToStatus("no_answer"), "NO_ANSWER");
  assert.equal(mapDispositionToStatus("busy"), "FAILED");
  assert.equal(mapDispositionToStatus("failed"), "FAILED");
  assert.equal(mapDispositionToStatus("cancel"), "FAILED");
  assert.equal(mapDispositionToStatus("some-future-zadarma-value"), null);
  assert.equal(mapDispositionToStatus(undefined), null);
});
