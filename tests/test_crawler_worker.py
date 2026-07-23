import unittest

from bs4 import BeautifulSoup

from python.crawler_worker import page_text


class PageTextTests(unittest.TestCase):
    def test_regex_cleaning_removes_boilerplate_and_duplicates(self) -> None:
        soup = BeautifulSoup(
            """
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
            """,
            "html.parser",
        )

        text = page_text(soup, True)

        self.assertNotIn("Global navigation", text)
        self.assertNotIn("We use cookies", text)
        self.assertNotIn("All rights reserved", text)
        self.assertEqual(text.count("Heavy-duty PVC tarpaulin"), 1)
        self.assertIn("sales@example.com", text)

    def test_regex_cleaning_can_be_disabled(self) -> None:
        soup = BeautifulSoup(
            """
            <html><body>
              <div class="cookie-consent">We use cookies on this website.</div>
              <main><p>Primary company content for industrial buyers.</p></main>
            </body></html>
            """,
            "html.parser",
        )

        text = page_text(soup, False)

        self.assertIn("We use cookies", text)
        self.assertIn("Primary company content", text)


if __name__ == "__main__":
    unittest.main()
