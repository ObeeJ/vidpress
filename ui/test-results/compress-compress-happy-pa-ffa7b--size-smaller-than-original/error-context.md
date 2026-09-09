# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: compress.spec.ts >> compress happy path — result size smaller than original
- Location: e2e/compress.spec.ts:6:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /compress/i }).first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: /compress/i }).first() with timeout 15000ms
  - waiting for getByRole('button', { name: /compress/i }).first()

```

```yaml
- banner:
  - link "theflate":
    - /url: /
    - img
    - text: theflate
  - navigation:
    - link "Engine":
      - /url: /
    - link "API Docs":
      - /url: /docs
- main:
  - heading "Deflate any file. Instantly." [level=1]
  - paragraph: Theflate video, audio, and images by up to 90% with zero visible quality loss. High-speed media processing for developers and creators.
  - tablist:
    - tab "Upload" [selected]
    - tab "Social Link"
    - tab "Screen"
    - tab "Live"
  - img
  - paragraph: Drop video, audio, or image files here
  - paragraph: or click to browse local files
  - text: MP4 MOV MKV WebM MP3 WAV FLAC JPG PNG WebP GIF
  - button "Upload video, audio, or image files"
  - text: Active Queue (1)
  - img
  - text: fixture.mp4
  - button "Remove item": ×
  - text: "Upload failed: Error: Upload failed"
- contentinfo:
  - img
  - text: theflate
  - paragraph: Deflate media sizes instantly. Built for developers, product teams, and digital creators.
  - text: Free jobs purged after 24h • Paid subscriber outputs stored in vault for 7 days. Product
  - link "Engine":
    - /url: /
  - link "Pricing":
    - /url: /pricing
  - link "API Docs":
    - /url: /docs
  - text: Legal & Trust
  - link "Terms of Service":
    - /url: /terms
  - link "Privacy Policy":
    - /url: /privacy
  - text: © 2026 theflate Engine. All rights reserved. Zero Third-Party Tracking • Automated File Disposal
- alert
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import path from "path";
  3  | 
  4  | const FIXTURE = path.join(__dirname, "fixture.mp4");
  5  | 
  6  | test("compress happy path — result size smaller than original", async ({ page }) => {
  7  |   await page.goto("/");
  8  | 
  9  |   // Upload via the hidden file input
  10 |   const input = page.locator("#dropzone-input");
  11 |   await input.setInputFiles(FIXTURE);
  12 | 
  13 |   // Wait for the profile to load (Inspecting file... → Compress button appears)
  14 |   const compressBtn = page.getByRole("button", { name: /compress/i }).first();
> 15 |   await expect(compressBtn).toBeVisible({ timeout: 15_000 });
     |                             ^ Error: expect(locator).toBeVisible() failed
  16 |   await compressBtn.click();
  17 | 
  18 |   // Wait for done status (up to 30s)
  19 |   const resultRow = page.locator(".contract").first();
  20 |   await expect(resultRow).toBeVisible({ timeout: 30_000 });
  21 | 
  22 |   // The ratio cell should contain a − (U+2212) or a % sign
  23 |   const saved = page.locator(".contract").getByText(/%/);
  24 |   await expect(saved).toBeVisible();
  25 | });
  26 | 
```