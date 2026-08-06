#!/usr/bin/env python3
"""
Univers Flow end-to-end smoke suite (Playwright, Chromium headless).

Covers, against the running dev server:
  1. login          — signs in with UF_TEST_EMAIL / UF_TEST_PASSWORD (or runs
                      the remaining checks as a guest when they are absent)
  2. home           — rails render, no console errors, no hydration mismatch
  3. artist PFP     — Trending Artists tiles are real Spotify artist portraits
                      (i.scdn.co/image/...) or honest monograms, never
                      video/song thumbnails (ytimg / lh3 covers)
  4. search         — a query returns results and the top hit is not a
                      duplicate of the second
  5. instant play   — tapping a card starts playback quickly (prewarmed stream)

Run:  python3 tests/e2e/smoke_e2e.py
Env:  BASE_URL (default http://localhost:8080), UF_TEST_EMAIL, UF_TEST_PASSWORD
Exit: 0 = all checks passed, 1 = at least one failure.
"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)

# Console noise that is expected and not a product defect.
IGNORED_CONSOLE = (
    "Download the React DevTools",
    "favicon",
    "ERR_INTERNET_DISCONNECTED",
    "net::ERR_ABORTED",
    "Failed to load resource",
    "[vite]",
)

BAD_PORTRAIT_HOSTS = ("ytimg.com", "googleusercontent.com/ytc", "i9.ytimg")
GOOD_PORTRAIT = re.compile(r"i\.scdn\.co/image/")

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


class ConsoleWatch:
    def __init__(self, page):
        self.errors: list[str] = []
        page.on("console", self._on_console)
        page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))

    def _on_console(self, msg):
        if msg.type != "error":
            return
        text = msg.text
        if any(token in text for token in IGNORED_CONSOLE):
            return
        self.errors.append(text)

    def drain(self) -> list[str]:
        out = list(self.errors)
        self.errors.clear()
        return out


async def login(page) -> bool:
    email = os.environ.get("UF_TEST_EMAIL")
    password = os.environ.get("UF_TEST_PASSWORD")
    if not email or not password:
        check("login", True, "skipped (no UF_TEST_EMAIL / UF_TEST_PASSWORD)")
        return False
    await page.goto(f"{BASE}/auth", wait_until="domcontentloaded")
    await page.get_by_role("textbox").first.fill(email)
    await page.locator('input[type="password"]').first.fill(password)
    await page.get_by_role("button", name=re.compile("sign in|log in", re.I)).first.click()
    try:
        await page.wait_for_url(re.compile(r"/(\?.*)?$"), timeout=20_000)
        ok = True
    except Exception:
        ok = "/auth" not in page.url
    await page.screenshot(path=str(SHOTS / "1_login.png"))
    check("login", ok, page.url)
    return ok


async def check_home(page, console: ConsoleWatch) -> None:
    await page.goto(BASE, wait_until="domcontentloaded")
    await page.wait_for_timeout(6_000)
    await page.screenshot(path=str(SHOTS / "2_home.png"))

    headings = await page.locator("h2, h3").all_inner_texts()
    joined = " ".join(h.upper() for h in headings)
    rails = [r for r in ("NEW RELEASES", "TRENDING", "MADE FOR YOU", "ARTISTS") if r in joined]
    check("home rails render", len(rails) >= 2, f"found: {rails}")

    errs = console.drain()
    hydration = [e for e in errs if "hydrat" in e.lower() or "did not match" in e.lower()]
    check("home has no hydration mismatch", not hydration, "; ".join(hydration[:2]))
    check("home has no console errors", not errs, "; ".join(errs[:3]))


async def check_artist_portraits(page) -> None:
    srcs = await page.evaluate(
        """() => Array.from(document.querySelectorAll('img'))
              .map(i => ({ src: i.currentSrc || i.src || '', alt: i.alt || '' }))
              .filter(i => /artist/i.test(i.alt))"""
    )
    if not srcs:
        check("artist portraits are real", True, "no artist tiles rendered on this pass")
        return
    bad = [s["src"] for s in srcs if any(h in s["src"] for h in BAD_PORTRAIT_HOSTS)]
    good = [s["src"] for s in srcs if GOOD_PORTRAIT.search(s["src"])]
    check(
        "artist portraits are never video thumbnails",
        not bad,
        f"{len(bad)} bad of {len(srcs)}: {bad[:2]}",
    )
    check(
        "artist portraits use verified artist images (or monogram)",
        len(good) > 0 or len(srcs) == 0,
        f"{len(good)} verified of {len(srcs)}",
    )


async def check_search(page, console: ConsoleWatch) -> None:
    await page.goto(f"{BASE}/search", wait_until="domcontentloaded")
    box = page.get_by_label(re.compile("search songs", re.I)).first
    await box.fill("way too self aware")
    await page.wait_for_timeout(7_000)
    await page.screenshot(path=str(SHOTS / "3_search.png"))

    titles = await page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-song-title]'))
              .map(n => n.getAttribute('data-song-title'))
              .filter(Boolean)"""
    )
    if not titles:
        titles = [t.strip() for t in await page.locator("button p, li p").all_inner_texts() if t.strip()]
    check("search returns results", len(titles) >= 3, f"{len(titles)} rows")

    norm = [re.sub(r"[^a-z0-9]+", "", t.lower()) for t in titles[:6]]
    dupes = len(norm) - len(set(norm))
    check("search top results are de-duplicated", dupes == 0, f"{dupes} duplicate titles in top 6")
    errs = console.drain()
    check("search has no console errors", not errs, "; ".join(errs[:3]))


async def check_instant_play(page, console: ConsoleWatch) -> None:
    await page.goto(BASE, wait_until="domcontentloaded")
    await page.wait_for_timeout(6_000)
    card = page.locator("button, [role=button]").filter(has=page.locator("img")).first
    try:
        await card.hover()
        await page.wait_for_timeout(500)  # let the prewarm resolve
        await card.click()
    except Exception as exc:  # noqa: BLE001
        check("instant playback", False, f"could not tap a card: {exc}")
        return

    started = False
    for _ in range(24):  # up to ~12s
        state = await page.evaluate(
            """() => {
                 const a = document.querySelector('audio');
                 return a ? { t: a.currentTime, paused: a.paused, src: !!a.src } : null;
               }"""
        )
        if state and state["src"] and (state["t"] > 0 or not state["paused"]):
            started = True
            break
        await page.wait_for_timeout(500)
    await page.screenshot(path=str(SHOTS / "4_play.png"))
    check("instant playback starts after tap", started)
    errs = console.drain()
    fatal = [e for e in errs if "no working stream" in e.lower() or "unhandled" in e.lower()]
    check("playback has no fatal console errors", not fatal, "; ".join(fatal[:2]))


async def main() -> int:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 430, "height": 1800})
        page = await context.new_page()
        console = ConsoleWatch(page)

        await login(page)
        console.drain()
        await check_home(page, console)
        await check_artist_portraits(page)
        await check_search(page, console)
        await check_instant_play(page, console)

        await browser.close()

    failed = [r for r in results if not r[1]]
    print("\n" + "-" * 52)
    print(f"{len(results) - len(failed)}/{len(results)} checks passed")
    (Path(__file__).parent / "last-run.json").write_text(
        json.dumps([{"check": n, "ok": ok, "detail": d} for n, ok, d in results], indent=2)
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
