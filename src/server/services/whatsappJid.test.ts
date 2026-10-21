import { test } from "node:test";
import assert from "node:assert/strict";
import { isGroupJid, isPersonalJid, extractPersonalPhoneNumber, resolveConversationDisplay } from "./whatsappJid";

// Regression coverage for "distinguish groups from personal chats using the
// JID only, never a display name" — the exact JID shapes here are taken
// directly from this CRM's own live production data (checked during
// investigation, not guessed), confirming both suffix families actually
// occur in practice.

test("isGroupJid: a real group JID (observed live) is identified as a group", () => {
  assert.equal(isGroupJid("120363426877091849@g.us"), true);
});

test("isGroupJid: a real personal JID (observed live) is NOT identified as a group", () => {
  assert.equal(isGroupJid("923244373788@s.whatsapp.net"), false);
});

test("isGroupJid: null/undefined/empty never throws, resolves to false", () => {
  assert.equal(isGroupJid(null), false);
  assert.equal(isGroupJid(undefined), false);
  assert.equal(isGroupJid(""), false);
});

test("isPersonalJid: both recognized personal suffixes are accepted", () => {
  assert.equal(isPersonalJid("923244373788@s.whatsapp.net"), true);
  assert.equal(isPersonalJid("923244373788@c.us"), true);
});

test("isPersonalJid: a group JID is never also classified as personal — the two are mutually exclusive", () => {
  assert.equal(isPersonalJid("120363426877091849@g.us"), false);
});

test("isPersonalJid: null/undefined/empty never throws, resolves to false", () => {
  assert.equal(isPersonalJid(null), false);
  assert.equal(isPersonalJid(undefined), false);
});

test("extractPersonalPhoneNumber: strips the suffix and returns digits only, for a real observed personal JID", () => {
  assert.equal(extractPersonalPhoneNumber("923244373788@s.whatsapp.net"), "923244373788");
});

test("extractPersonalPhoneNumber: works for the @c.us suffix too", () => {
  assert.equal(extractPersonalPhoneNumber("923244373788@c.us"), "923244373788");
});

test("extractPersonalPhoneNumber: returns null for a group JID — never guesses or strips an arbitrary suffix", () => {
  assert.equal(extractPersonalPhoneNumber("120363426877091849@g.us"), null);
});

test("extractPersonalPhoneNumber: returns null for a malformed value (non-digit prefix) rather than returning garbage", () => {
  assert.equal(extractPersonalPhoneNumber("not-a-real-id@s.whatsapp.net"), null);
});

test("extractPersonalPhoneNumber: null/undefined never throws, resolves to null", () => {
  assert.equal(extractPersonalPhoneNumber(null), null);
  assert.equal(extractPersonalPhoneNumber(undefined), null);
});

test("classification is never based on display name — two JIDs with the exact same associated name classify independently purely from the JID shape", () => {
  // Simulates the real production scenario: multiple distinct conversations
  // all displayed as "Itzaz khalid" — a 1-on-1 and several groups. Each
  // must classify correctly on its own, regardless of the shared name.
  const personalJid = "923244373788@s.whatsapp.net";
  const groupJidA = "120363426877091849@g.us";
  const groupJidB = "120363412068628251@g.us";
  assert.equal(isGroupJid(personalJid), false);
  assert.equal(isGroupJid(groupJidA), true);
  assert.equal(isGroupJid(groupJidB), true);
});

// --- resolveConversationDisplay: the single UI source of truth ---

const FALLBACKS = { personal: "Unknown sender", group: "Group chat" };

test("resolveConversationDisplay: a personal chat with a resolved subject shows that name plus its phone number", () => {
  const display = resolveConversationDisplay(
    { contactName: null, subject: "Haider", externalThreadId: "923027542809@s.whatsapp.net" },
    FALLBACKS
  );
  assert.deepEqual(display, { name: "Haider", isGroup: false, phoneNumber: "923027542809" });
});

test("resolveConversationDisplay: a group chat with a resolved subject (the real group name) shows that name, never a phone number", () => {
  const display = resolveConversationDisplay(
    { contactName: null, subject: "Project Team", externalThreadId: "120363426877091849@g.us" },
    FALLBACKS
  );
  assert.deepEqual(display, { name: "Project Team", isGroup: true, phoneNumber: null });
});

test("resolveConversationDisplay: a group with no resolved name yet shows the GROUP fallback, never the personal fallback or a blank value — this is the direct fix for 'avoid displaying a customer's name as a group name'", () => {
  const display = resolveConversationDisplay(
    { contactName: null, subject: null, externalThreadId: "120363426877091849@g.us" },
    FALLBACKS
  );
  assert.equal(display.name, "Group chat");
  assert.equal(display.isGroup, true);
});

test("resolveConversationDisplay: a personal chat with no resolved subject yet shows the PERSONAL fallback", () => {
  const display = resolveConversationDisplay(
    { contactName: null, subject: null, externalThreadId: "923027542809@s.whatsapp.net" },
    FALLBACKS
  );
  assert.equal(display.name, "Unknown sender");
  assert.equal(display.isGroup, false);
});

test("resolveConversationDisplay: a linked CRM contact's name (contactName) takes priority over subject for a personal chat", () => {
  const display = resolveConversationDisplay(
    { contactName: "Real Contact Name", subject: "Whatever Whapi Resolved", externalThreadId: "923027542809@s.whatsapp.net" },
    FALLBACKS
  );
  assert.equal(display.name, "Real Contact Name");
});

test("resolveConversationDisplay: two conversations sharing the exact same subject/name text still classify and display independently when their JIDs differ (group vs personal) — the real-world 'Itzaz khalid' scenario", () => {
  const sharedName = "Itzaz khalid";
  const personalDisplay = resolveConversationDisplay(
    { contactName: null, subject: sharedName, externalThreadId: "923244373788@s.whatsapp.net" },
    FALLBACKS
  );
  const groupDisplay = resolveConversationDisplay(
    { contactName: null, subject: sharedName, externalThreadId: "120363426877091849@g.us" },
    FALLBACKS
  );
  assert.equal(personalDisplay.isGroup, false);
  assert.equal(personalDisplay.phoneNumber, "923244373788");
  assert.equal(groupDisplay.isGroup, true);
  assert.equal(groupDisplay.phoneNumber, null);
});
