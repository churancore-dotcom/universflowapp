# Univers Flow end-to-end smoke suite

```bash
# guest pass (auth-gated checks are reported as skips)
python3 tests/e2e/smoke_e2e.py

# full pass — required to actually exercise home rails, search, artist
# portraits and instant playback
UF_TEST_EMAIL="you@example.com" UF_TEST_PASSWORD="…" python3 tests/e2e/smoke_e2e.py
```

Checks: login, home rails + hydration/console cleanliness, artist portraits
(verified artist images only, never video thumbnails), search results and
de-duplication, and instant playback after a tap.

Screenshots land in `tests/e2e/screenshots/`, machine-readable results in
`tests/e2e/last-run.json`. Exit code is non-zero if any check fails.
