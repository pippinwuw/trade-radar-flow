from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import sys
import time
import uuid
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup


PAGE_HINT = re.compile(
    r"about|company|profile|history|product|catalog(?:ue)?|contact|"
    r"who-we-are|what-we-do|solution|service|industr(?:y|ies)|"
    r"capabilit|market|brand|location|branch|team|distribution|export|import",
    re.IGNORECASE,
)
PAGE_PRIORITIES = (
    (re.compile(r"contact|location|branch", re.IGNORECASE), 100),
    (re.compile(r"about|company|profile|who-we-are|history", re.IGNORECASE), 95),
    (re.compile(r"product|catalog(?:ue)?|brand", re.IGNORECASE), 90),
    (re.compile(r"industr(?:y|ies)|market|solution|what-we-do", re.IGNORECASE), 80),
    (re.compile(r"capabilit|service|distribution|export|import", re.IGNORECASE), 75),
    (re.compile(r"team|management", re.IGNORECASE), 60),
)
SKIPPED_PAGE_SUFFIXES = {
    ".7z",
    ".avi",
    ".css",
    ".doc",
    ".docx",
    ".gif",
    ".gz",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".rar",
    ".svg",
    ".tar",
    ".webp",
    ".xls",
    ".xlsx",
    ".zip",
}
EMAIL_PATTERN = re.compile(
    r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE
)
PHONE_PATTERN = re.compile(r"(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){8,14}\d")
NOISE_ATTRIBUTE_PATTERN = re.compile(
    r"(?:^|[-_\s])(?:"
    r"cookie|consent|popup|modal|newsletter|subscribe|"
    r"social[-_\s](?:links?|icons?|media)|share[-_\s](?:links?|buttons?)|"
    r"breadcrumb|pagination|advert(?:isement)?|"
    r"back[-_\s]?to[-_\s]?top"
    r")(?:$|[-_\s])",
    re.IGNORECASE,
)
BOILERPLATE_LINE_PATTERNS = (
    re.compile(r"^(?:skip to (?:main )?content|back to top)$", re.IGNORECASE),
    re.compile(r"^(?:follow|connect with) us(?: on)?\b", re.IGNORECASE),
    re.compile(
        r"^(?:subscribe|sign up) (?:to|for) (?:our )?(?:newsletter|updates)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?:privacy policy|cookie policy|terms (?:of use|and conditions))$",
        re.IGNORECASE,
    ),
    re.compile(r"^(?:©|\(c\)|copyright\b).*\ball rights reserved\b", re.IGNORECASE),
    re.compile(
        r"^(?:we (?:use|value) cookies|this (?:site|website) uses cookies|"
        r"by (?:using|continuing to use) (?:this|our) (?:site|website)).*$",
        re.IGNORECASE,
    ),
)
BASE_NOISE_TAGS = ("script", "style", "noscript", "svg", "nav", "template")
STRUCTURAL_NOISE_TAGS = ("header", "footer", "aside", "form", "button", "dialog")
DEFAULT_MAX_PAGES = 20


def bounded_positive_env(name: str, fallback: int, maximum: int) -> int:
    try:
        return min(maximum, max(1, int(os.getenv(name, str(fallback)))))
    except (TypeError, ValueError):
        return fallback


MAX_HTML_BYTES = bounded_positive_env(
    "PYTHON_CRAWLER_MAX_HTML_BYTES",
    4_000_000,
    10_000_000,
)
MAX_REDIRECTS = 3
DOMAIN_DEADLINE_SECONDS = bounded_positive_env(
    "PYTHON_CRAWLER_DOMAIN_DEADLINE_SECONDS",
    75,
    110,
)
USER_AGENT = "TradeRadarFlow/0.2 (+single-user public company research)"


def log_event(level: str, event: str, **data: Any) -> None:
    sys.stderr.write(
        json.dumps(
            {"level": level, "event": event, "data": data},
            ensure_ascii=False,
        )
        + "\n"
    )
    sys.stderr.flush()


def assert_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("只允许 http/https 网站")
    if parsed.username or parsed.password:
        raise ValueError("网址不能包含用户名或密码")
    if not parsed.hostname:
        raise ValueError("网址缺少主机名")
    records = socket.getaddrinfo(parsed.hostname, parsed.port or 443)
    if not records:
        raise ValueError("域名无法解析")
    for record in records:
        address = ipaddress.ip_address(record[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
        ):
            raise ValueError("不允许访问本机或私有网络地址")


def fetch_html(session: requests.Session, initial_url: str) -> tuple[str, str]:
    current = initial_url
    for _ in range(MAX_REDIRECTS + 1):
        assert_public_url(current)
        response = session.get(
            current,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
            },
            timeout=(6, 15),
            allow_redirects=False,
            stream=True,
        )
        if 300 <= response.status_code < 400:
            location = response.headers.get("location")
            response.close()
            if not location:
                raise ValueError("网页重定向缺少 Location")
            current = urljoin(current, location)
            continue
        if not response.ok:
            response.close()
            raise ValueError(f"网页请求失败：HTTP {response.status_code}")
        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type:
            response.close()
            raise ValueError("目标地址不是 HTML 网页")
        declared = int(response.headers.get("content-length", "0") or "0")
        if declared > MAX_HTML_BYTES:
            response.close()
            raise ValueError("网页体积超过抓取上限")
        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_content(64 * 1024):
            size += len(chunk)
            if size > MAX_HTML_BYTES:
                response.close()
                raise ValueError("网页体积超过抓取上限")
            chunks.append(chunk)
        encoding = response.encoding or "utf-8"
        response.close()
        return b"".join(chunks).decode(encoding, errors="replace"), current
    raise ValueError(f"网页重定向超过 {MAX_REDIRECTS} 次")


def normalized_page_url(raw_url: str) -> str:
    parsed = urlparse(raw_url)
    filtered_query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith(("utm_", "fbclid", "gclid", "ref"))
    ]
    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/")
    return urlunparse(
        parsed._replace(
            path=path,
            query=urlencode(filtered_query),
            fragment="",
        )
    )


def link_priority(label: str) -> int:
    return max(
        (
            priority
            for pattern, priority in PAGE_PRIORITIES
            if pattern.search(label)
        ),
        default=50,
    )


def extract_related_links(
    soup: BeautifulSoup,
    final_url: str,
) -> list[tuple[int, str]]:
    hostname = (urlparse(final_url).hostname or "").lower().removeprefix("www.")
    links: dict[str, int] = {}
    for anchor in soup.find_all("a", href=True):
        link = urljoin(final_url, str(anchor["href"]))
        parsed = urlparse(link)
        link_host = (parsed.hostname or "").lower().removeprefix("www.")
        label = f"{parsed.path} {anchor.get_text(' ', strip=True)}"
        suffix = parsed.path.lower().rsplit("/", 1)[-1]
        extension = f".{suffix.rsplit('.', 1)[-1]}" if "." in suffix else ""
        if (
            link_host != hostname
            or parsed.scheme not in {"http", "https"}
            or extension in SKIPPED_PAGE_SUFFIXES
            or not PAGE_HINT.search(label)
        ):
            continue
        normalized = normalized_page_url(link)
        links[normalized] = max(links.get(normalized, 0), link_priority(label))
    return sorted(
        ((priority, link) for link, priority in links.items()),
        key=lambda item: (-item[0], item[1]),
    )


def regex_clean_lines(text: str) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    for raw_line in text.splitlines():
        line = re.sub(r"[\s\u00a0]+", " ", raw_line).strip()
        if not line:
            continue
        if any(pattern.search(line) for pattern in BOILERPLATE_LINE_PATTERNS):
            continue
        fingerprint = line.casefold()
        if len(fingerprint) >= 20 and fingerprint in seen:
            continue
        seen.add(fingerprint)
        lines.append(line)
    return "\n".join(lines)


def contact_lines(soup: BeautifulSoup) -> list[str]:
    lines: list[str] = []
    seen: set[str] = set()
    for raw_line in soup.get_text("\n", strip=True).splitlines():
        line = re.sub(r"[\s\u00a0]+", " ", raw_line).strip()
        if not line or not (
            EMAIL_PATTERN.search(line) or PHONE_PATTERN.search(line)
        ):
            continue
        fingerprint = line.casefold()
        if fingerprint not in seen:
            seen.add(fingerprint)
            lines.append(line[:500])
    return lines


def page_text(soup: BeautifulSoup, enable_regex_cleaning: bool) -> str:
    preserved_contacts = contact_lines(soup)
    for element in soup(BASE_NOISE_TAGS):
        element.decompose()
    for element in soup(STRUCTURAL_NOISE_TAGS):
        element.decompose()
    if enable_regex_cleaning:
        for element in list(soup.find_all(True)):
            if element.parent is None:
                continue
            attributes = " ".join(
                [
                    str(element.get("id", "")),
                    *[str(value) for value in element.get("class", [])],
                ]
            )
            if NOISE_ATTRIBUTE_PATTERN.search(attributes):
                element.decompose()

    root = soup.select_one("main, [role='main']")
    if root is None or len(root.get_text(" ", strip=True)) < 200:
        articles = soup.find_all("article")
        article_text = "\n".join(
            article.get_text("\n", strip=True) for article in articles
        )
        source_text = (
            article_text
            if len(article_text) >= 200
            else (soup.body or soup).get_text("\n", strip=True)
        )
    else:
        source_text = root.get_text("\n", strip=True)

    if preserved_contacts:
        source_text = "\n".join([source_text, *preserved_contacts])
    if enable_regex_cleaning:
        return regex_clean_lines(source_text)
    return re.sub(r"\s+", " ", source_text).strip()


def clean_page(
    session: requests.Session,
    url: str,
    enable_regex_cleaning: bool = True,
) -> tuple[dict[str, str], list[tuple[int, str]]]:
    html, final_url = fetch_html(session, url)
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else urlparse(final_url).hostname
    links = extract_related_links(soup, final_url)
    text = page_text(soup, enable_regex_cleaning)
    hostname = (urlparse(final_url).hostname or "").lower().removeprefix("www.")
    return {"url": final_url, "title": title or hostname, "text": text}, links


def nearby_text(text: str, value: str) -> str:
    index = text.find(value)
    if index < 0:
        return ""
    return text[max(0, index - 80) : index + len(value) + 80]


def extract_contacts(pages: list[dict[str, str]]) -> list[dict[str, str]]:
    contacts: dict[str, dict[str, str]] = {}
    for page in pages:
        text = page["text"]
        for email in EMAIL_PATTERN.findall(text):
            value = email.lower()
            contacts[f"email:{value}"] = {
                "type": "email",
                "value": value,
                "sourceUrl": page["url"],
                "nearbyText": nearby_text(text, email),
            }
        for match in PHONE_PATTERN.finditer(text):
            value = re.sub(r"\s+", " ", match.group(0)).strip()
            contact_type = (
                "whatsapp"
                if "whatsapp" in nearby_text(text.lower(), match.group(0).lower())
                else "phone"
            )
            contacts[f"{contact_type}:{value}"] = {
                "type": contact_type,
                "value": value,
                "sourceUrl": page["url"],
                "nearbyText": nearby_text(text, match.group(0)),
            }
    return list(contacts.values())


def crawl(params: dict[str, Any]) -> dict[str, Any]:
    started = time.monotonic()
    initial_url = str(params.get("url", ""))
    if not initial_url:
        raise ValueError("缺少 url")
    search_hit = params.get("searchHit")
    enable_regex_cleaning = params.get("enableRegexCleaning", True)
    if not isinstance(enable_regex_cleaning, bool):
        raise ValueError("enableRegexCleaning 必须是布尔值")
    raw_max_pages = params.get("maxPages")
    try:
        max_pages = (
            DEFAULT_MAX_PAGES
            if raw_max_pages is None
            else int(raw_max_pages)
        )
    except (TypeError, ValueError) as error:
        raise ValueError("maxPages 必须是正整数") from error
    if max_pages < 1:
        raise ValueError("maxPages 必须是正整数")
    log_event(
        "info",
        "crawl_started",
        url=initial_url,
        regexCleaning=enable_regex_cleaning,
        maxPages=max_pages,
    )
    with requests.Session() as session:
        try:
            first, links = clean_page(
                session,
                initial_url,
                enable_regex_cleaning,
            )
        except Exception as initial_error:
            parsed_initial = urlparse(initial_url)
            fallback_url = normalized_page_url(
                urlunparse(
                    parsed_initial._replace(path="/", query="", fragment="")
                )
            )
            if fallback_url == normalized_page_url(initial_url):
                raise
            log_event(
                "warn",
                "initial_page_fallback",
                url=initial_url,
                fallbackUrl=fallback_url,
                error=str(initial_error),
            )
            first, links = clean_page(
                session,
                fallback_url,
                enable_regex_cleaning,
            )
        first["url"] = normalized_page_url(first["url"])
        pages = [first]
        attempted = {first["url"]}
        captured = {first["url"]}
        parsed_homepage = urlparse(first["url"])
        root_url = normalized_page_url(
            urlunparse(
                parsed_homepage._replace(path="/", query="", fragment="")
            )
        )
        queue = list(links)
        if root_url not in attempted:
            queue.append((110, root_url))
        deadline_reached = False
        while queue and len(pages) < max_pages:
            if time.monotonic() - started >= DOMAIN_DEADLINE_SECONDS:
                deadline_reached = True
                log_event(
                    "warn",
                    "crawl_deadline_reached",
                    url=first["url"],
                    pageCount=len(pages),
                    deadlineSeconds=DOMAIN_DEADLINE_SECONDS,
                )
                break
            queue.sort(key=lambda item: (-item[0], item[1]))
            _priority, link = queue.pop(0)
            if link in attempted:
                continue
            attempted.add(link)
            try:
                page, discovered = clean_page(
                    session,
                    link,
                    enable_regex_cleaning,
                )
                page["url"] = normalized_page_url(page["url"])
                if page["url"] not in captured:
                    captured.add(page["url"])
                    pages.append(page)
                for discovered_priority, discovered_link in discovered:
                    if discovered_link not in attempted:
                        queue.append(
                            (discovered_priority, discovered_link)
                        )
            except Exception as error:
                log_event(
                    "warn",
                    "page_skipped",
                    url=link,
                    error=str(error),
                )
                continue
    homepage = first["url"]
    domain = (urlparse(homepage).hostname or "").lower().removeprefix("www.")
    snippet = (
        str(search_hit.get("snippet", ""))
        if isinstance(search_hit, dict)
        else ""
    )
    result = {
        "id": str(uuid.uuid4()),
        "homepage": homepage,
        "domain": domain,
        "searchSnippet": snippet or first["text"][:280],
        "pages": pages,
        "contactCandidates": extract_contacts(pages),
        "searchHit": search_hit,
        "crawlWarnings": (
            [
                f"Reached safe crawl deadline after "
                f"{DOMAIN_DEADLINE_SECONDS}s; retained partial pages."
            ]
            if deadline_reached
            else []
        ),
    }
    log_event(
        "info",
        "crawl_completed",
        domain=domain,
        pageCount=len(pages),
        contactCandidateCount=len(result["contactCandidates"]),
        regexCleaning=enable_regex_cleaning,
        durationMs=round((time.monotonic() - started) * 1000),
        deadlineReached=deadline_reached,
    )
    return result


def respond(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    for raw_line in sys.stdin:
        try:
            request = json.loads(raw_line)
            request_id = request.get("id")
            if request.get("method") != "crawl":
                raise ValueError("不支持的方法")
            result = crawl(request.get("params") or {})
            respond({"id": request_id, "ok": True, "result": result})
        except Exception as error:
            log_event(
                "error",
                "request_failed",
                requestId=request.get("id") if "request" in locals() else None,
                error=str(error),
            )
            respond(
                {
                    "id": request.get("id") if "request" in locals() else None,
                    "ok": False,
                    "error": str(error),
                }
            )


if __name__ == "__main__":
    main()
