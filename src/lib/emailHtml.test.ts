import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeEmailHtml } from "./emailHtml";

// Security-critical: this is the one function standing between an inbound
// (or outbound) email's raw HTML and dangerouslySetInnerHTML. Every test
// here uses synthetic content — never real customer data.

test("sanitizeEmailHtml: strips <script> tags entirely", () => {
  const result = sanitizeEmailHtml('<p>Hello</p><script>alert("xss")</script>');
  assert.ok(!result.includes("script"));
  assert.ok(!result.includes("alert"));
  assert.ok(result.includes("Hello"));
});

test("sanitizeEmailHtml: strips event-handler attributes (onerror, onclick, etc.)", () => {
  const result = sanitizeEmailHtml('<p onclick="stealCookies()">Click me</p>');
  assert.ok(!result.includes("onclick"));
  assert.ok(!result.includes("stealCookies"));
  assert.ok(result.includes("Click me"));
});

test("sanitizeEmailHtml: strips javascript: URLs from links", () => {
  const result = sanitizeEmailHtml('<a href="javascript:alert(1)">Click</a>');
  assert.ok(!result.includes("javascript:"));
});

test("sanitizeEmailHtml: blocks ALL <img> tags by default (remote tracking image protection)", () => {
  const result = sanitizeEmailHtml('<p>Hi</p><img src="https://evil.example.com/track.gif?id=abc123" width="1" height="1">');
  assert.ok(!result.includes("<img"));
  assert.ok(!result.includes("evil.example.com"));
  assert.ok(result.includes("Hi"));
});

test("sanitizeEmailHtml: strips <iframe>/<object>/<embed>/<form>/<input>/<button>", () => {
  const input = '<p>Safe</p><iframe src="https://evil.example.com"></iframe><object data="x"></object><form><input type="text"><button>Go</button></form>';
  const result = sanitizeEmailHtml(input);
  assert.ok(!result.includes("iframe"));
  assert.ok(!result.includes("object"));
  assert.ok(!result.includes("<form"));
  assert.ok(!result.includes("<input"));
  assert.ok(!result.includes("<button"));
  assert.ok(result.includes("Safe"));
});

test("sanitizeEmailHtml: strips <style> blocks (never lets inbound CSS leak into the CRM UI)", () => {
  const result = sanitizeEmailHtml("<style>body { display: none; }</style><p>Visible</p>");
  assert.ok(!result.includes("<style"));
  assert.ok(result.includes("Visible"));
});

test("sanitizeEmailHtml: preserves safe formatting tags (bold, italic, underline, lists, links, tables)", () => {
  const input =
    '<p><b>Bold</b> <i>italic</i> <u>underline</u></p>' +
    '<ul><li>Item 1</li><li>Item 2</li></ul>' +
    '<a href="https://example.com">Link</a>' +
    '<table><tr><td>Cell</td></tr></table>';
  const result = sanitizeEmailHtml(input);
  assert.ok(result.includes("<b>Bold</b>") || result.includes("Bold"));
  assert.ok(result.includes("italic"));
  assert.ok(result.includes("<li>Item 1</li>"));
  assert.ok(result.includes('href="https://example.com"'));
  assert.ok(result.includes("Cell"));
});

test("sanitizeEmailHtml: forces target=_blank and rel=noopener noreferrer on every link, overriding the email's own attributes", () => {
  const result = sanitizeEmailHtml('<a href="https://example.com" target="_self" rel="opener">Click</a>');
  assert.ok(result.includes('target="_blank"'));
  assert.ok(result.includes('rel="noopener noreferrer"'));
  assert.ok(!result.includes('rel="opener"'));
});

test("sanitizeEmailHtml: a link with no target/rel at all still gets them added", () => {
  const result = sanitizeEmailHtml('<a href="https://example.com">Click</a>');
  assert.ok(result.includes('target="_blank"'));
  assert.ok(result.includes('rel="noopener noreferrer"'));
});

test("sanitizeEmailHtml: null/undefined/empty input returns an empty string, never throws", () => {
  assert.equal(sanitizeEmailHtml(null), "");
  assert.equal(sanitizeEmailHtml(undefined), "");
  assert.equal(sanitizeEmailHtml(""), "");
});

test("sanitizeEmailHtml: a malformed/unclosed-tag HTML fragment never throws", () => {
  assert.doesNotThrow(() => sanitizeEmailHtml("<p>Unclosed <b>bold <i>italic"));
});

test("sanitizeEmailHtml: strips data: URLs from links (a common XSS/phishing vector)", () => {
  const result = sanitizeEmailHtml('<a href="data:text/html,<script>alert(1)</script>">Click</a>');
  assert.ok(!result.includes("data:text/html"));
});

test("sanitizeEmailHtml: a deeply nested XSS attempt combining several vectors is fully neutralized", () => {
  const input =
    '<div onmouseover="exfiltrate()"><p>Legit text</p><script>document.cookie</script>' +
    '<img src=x onerror="exfiltrate()"><a href="javascript:void(0)" onclick="exfiltrate()">link</a></div>';
  const result = sanitizeEmailHtml(input);
  assert.ok(!result.includes("onmouseover"));
  assert.ok(!result.includes("onerror"));
  assert.ok(!result.includes("onclick"));
  assert.ok(!result.includes("script"));
  assert.ok(!result.includes("javascript:"));
  assert.ok(!result.includes("exfiltrate"));
  assert.ok(!result.includes("<img"));
  assert.ok(result.includes("Legit text"));
});
