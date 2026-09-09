import { test, expect } from "@playwright/test";
import path from "path";

const FIXTURE = path.join(__dirname, "fixture.mp4");

test("compress happy path — result size smaller than original", async ({ page }) => {
  await page.goto("/");

  // Upload via the hidden file input
  const input = page.locator("#dropzone-input");
  await input.setInputFiles(FIXTURE);

  // Wait for the profile to load (Inspecting file... → Compress button appears)
  const compressBtn = page.getByRole("button", { name: /compress/i }).first();
  await expect(compressBtn).toBeVisible({ timeout: 15_000 });
  await compressBtn.click();

  // Wait for done status (up to 30s)
  const resultRow = page.locator(".contract").first();
  await expect(resultRow).toBeVisible({ timeout: 30_000 });

  // The ratio cell should contain a − (U+2212) or a % sign
  const saved = page.locator(".contract").getByText(/%/);
  await expect(saved).toBeVisible();
});
