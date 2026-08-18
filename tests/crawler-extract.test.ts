import assert from "node:assert/strict";
import test from "node:test";
import {
  extractContacts,
  extractRelatedLinks,
  pageTextFromHtml,
} from "../src/crawler/extract.js";

test("regex cleaning removes boilerplate and duplicate lines but keeps contacts", () => {
  const text = pageTextFromHtml(
    `
    <html>
      <body>
        <header>Global navigation</header>
        <div class="cookie-consent">We use cookies to improve this website.</div>
        <main>
          <h1>Acme Industrial Fabrics</h1>
          <p>Heavy-duty PVC tarpaulin for logistics and construction.</p>
          <p>Heavy-duty PVC tarpaulin for logistics and construction.</p>
        </main>
        <footer>
          Copyright 2026 Acme. All rights reserved.
          <span>sales@example.com</span>
        </footer>
      </body>
    </html>
    `,
    true,
  );

  assert.equal(text.includes("Global navigation"), false);
  assert.equal(text.includes("We use cookies"), false);
  assert.equal(text.includes("All rights reserved"), false);
  assert.equal(text.split("Heavy-duty PVC tarpaulin").length - 1, 1);
  assert.equal(text.includes("sales@example.com"), true);
});

test("regex cleaning can be disabled", () => {
  const text = pageTextFromHtml(
    `
    <html><body>
      <div class="cookie-consent">We use cookies on this website.</div>
      <main><p>Primary company content for industrial buyers.</p></main>
    </body></html>
    `,
    false,
  );

  assert.equal(text.includes("We use cookies"), true);
  assert.equal(text.includes("Primary company content"), true);
});

test("page text preserves content beyond the legacy 18000 character cut", () => {
  const tailMarker = "VERIFIED_PAGE_TAIL_IMPORT_EVIDENCE";
  const text = pageTextFromHtml(
    `
    <html><body><main>
      <p>${"industrial fabric content ".repeat(900)}</p>
      <p>${tailMarker}</p>
    </main></body></html>
    `,
    true,
  );

  assert.ok(text.length > 18_000);
  assert.equal(text.includes(tailMarker), true);
});

test("related links stay on-host and skip binary suffixes", () => {
  const links = extractRelatedLinks(
    `
    <html><body>
      <a href="/about-us">About the company</a>
      <a href="/catalog.pdf">Catalog</a>
      <a href="https://other.example/contact">Other contact</a>
      <a href="/products">Product range</a>
    </body></html>
    `,
    "https://www.acme.example/",
  );
  const urls = links.map(([, url]) => url);
  assert.ok(urls.includes("https://www.acme.example/about-us"));
  assert.ok(urls.includes("https://www.acme.example/products"));
  assert.equal(urls.some((url) => url.endsWith(".pdf")), false);
  assert.equal(urls.some((url) => url.includes("other.example")), false);
});

test("extractContacts finds emails and WhatsApp numbers", () => {
  const contacts = extractContacts([
    {
      url: "https://acme.example/contact",
      title: "Contact",
      text: "Sales sales@acme.example WhatsApp +971 50 123 4567",
    },
  ]);
  assert.ok(
    contacts.some(
      (contact) =>
        contact.type === "email" && contact.value === "sales@acme.example",
    ),
  );
  assert.ok(
    contacts.some(
      (contact) =>
        contact.type === "whatsapp" && contact.value.includes("971"),
    ),
  );
});
