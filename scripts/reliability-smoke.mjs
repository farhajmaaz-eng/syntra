// Focused production-UI integration against an explicitly isolated real backend.
// It never enters a credential and never makes a Codex inference request.
import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
if (
  !resolve(process.env.FORGE_DATA_DIR || ".data").startsWith(
    "/tmp/forge-audit-",
  )
)
  throw new Error(
    "Use the same isolated /tmp/forge-audit-* data directory for worker, dashboard and this check.",
  );
const base = "http://127.0.0.1:3000";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function api(path, body) {
  const r = await page.request.post(`${base}/api/${path}`, { data: body });
  const out = await r.json();
  expect(r.ok(), JSON.stringify(out)).toBe(true);
  return out;
}
async function snapshot() {
  return (await page.request.get(`${base}/api/snapshot`)).json();
}
try {
  await api("pause", { paused: true });
  await page.goto(`${base}/settings`);
  await expect(
    page.getByRole("heading", { name: "OpenAI Codex" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Provider API key" }),
  ).toHaveCount(0);
  await page.getByLabel("Concurrent agents (1–3)").fill("2");
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot()).settings.concurrency)
    .toBe(2);
  let data = await snapshot();
  expect(data.provider.id).toBe("codex");
  expect(data.agents.map((a) => a.model)).toContain("gpt-6.2-sol");
  expect(data.agents.map((a) => a.model)).toContain("gpt-6.1-terra");
  console.log("PASS Codex-only settings, no provider key field and model defaults");

  await page.goto(`${base}/codex`);
  await expect(
    page.getByRole("heading", { name: "OpenAI Codex account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Main Codex orchestrator \+ seven subagents/,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("OpenAI API key")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with ChatGPT" }),
  ).toBeVisible();
  await expect(page.getByText("gpt-6.2-sol").first()).toBeVisible();
  await expect(page.getByText("gpt-6.1-terra").first()).toBeVisible();
  await expect(page.getByLabel("Codex instruction")).toHaveCount(0);
  console.log("PASS Codex auth, topology and default model visibility");

  await page.goto(`${base}/team?agent=Architect`);
  await expect(page.getByLabel("Codex model ID")).toHaveValue("gpt-6.1-terra");
  await page.goto(`${base}/team?agent=Lead`);
  await expect(page.getByLabel("Codex model ID")).toHaveValue("gpt-6.2-sol");

  for (const route of ["/settings", "/tasks", "/codex", "/team"]) {
    await page.goto(base + route);
    await expect(page.locator(".topbar")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  expect(errors).toEqual([]);
  console.log("PASS focused mobile layouts and browser console");
} finally {
  await api("pause", { paused: true }).catch(() => {});
  await browser.close();
}
