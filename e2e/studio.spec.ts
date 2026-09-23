import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { newProject, type Media } from "../src/ads/model";

test("local API rejects cross-site writes and invalid project paths", async ({
  request,
}) => {
  const crossSite = await request.post("/api/ads/projects", {
    headers: { origin: "https://example.com" },
    data: newProject(),
  });
  expect(crossSite.status()).toBe(403);
  const p = newProject();
  p.id = "../outside";
  expect((await request.post("/api/ads/projects", { data: p })).status()).toBe(
    400,
  );
});

test("legacy project loads receive safe motion defaults and media keeps origin protection", async ({
  request,
}) => {
  const p = newProject();
  const file = `data/projects/${p.id}.json`;
  const old = {
    ...p,
    motionStyle: undefined,
    voiceId: undefined,
    callouts: undefined,
  };
  fs.writeFileSync(file, JSON.stringify(old));
  try {
    const loaded = await (
      await request.get(`/api/ads/projects/${p.id}`)
    ).json();
    expect(loaded.motionStyle).toBe("clean");
    expect(loaded.voiceId).toBeNull();
    expect(loaded.callouts).toEqual([]);
    const response = await request.get("/api/ads/media/unknown.wav", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(response.status()).toBe(403);
  } finally {
    fs.unlinkSync(file);
  }
});

test("saved brand settings are reused in new projects", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/ads/brand")).json();
  try {
    await page.goto("/ads.html");
    await expect(page.getByRole("button", { name: "+ New ad" })).toBeEnabled();
    await page
      .getByRole("button", { name: "Brand & text", exact: true })
      .click();
    await page
      .getByLabel("Call to action", { exact: true })
      .fill("A saved brand CTA");
    await page.getByRole("button", { name: "Save as default brand" }).click();
    await expect(
      page.getByText("Brand preset saved for all new ads"),
    ).toBeVisible();
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "+ New ad" }).click();
    await expect(
      page.getByLabel("Call to action", { exact: true }),
    ).toHaveValue("A saved brand CTA");
  } finally {
    await request.post("/api/ads/brand", { data: original });
  }
});

test("import, spelling correction, timing review, save/reopen, and placement preview", async ({
  page,
  request,
}) => {
  test.skip(
    !fs.existsSync(".local/test/english-sample.mp4"),
    "Generate the synthetic speech fixture first; see docs/WORKFLOW.md",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/ads.html");
  await expect(page.getByRole("button", { name: "+ New ad" })).toBeEnabled();
  await page.getByRole("button", { name: "+ New ad" }).click();
  await page
    .getByLabel("Import video or music", { exact: true })
    .setInputFiles(".local/test/english-sample.mp4");
  await expect(page.getByLabel("Clip 1 start")).toBeVisible();
  await page.getByLabel("Project name").fill("Browser verification");
  await page.getByRole("button", { name: "+ Add line" }).click();
  await page.getByLabel("Subtitle 1 text").fill("Qualified leeds");
  await page.getByLabel("Subtitle 1 end").fill("3");
  await page
    .getByRole("button", { name: "Check spelling", exact: true })
    .click();
  await expect(page.getByText("leeds", { exact: true })).toBeVisible();
  await page.getByLabel("Subtitle 1 text").fill("Qualified leads");
  await page.getByLabel("Reviewed", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Export both placements" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "1:1 · Feed", exact: true }).click();
  await expect(page.locator(".preview-frame.square")).toBeVisible();
  await page.getByLabel("Export resolution").selectOption("720");
  await page.getByLabel("Clip 1 rotation").selectOption("90");
  await page.getByRole("button", { name: "Brand & text", exact: true }).click();
  await page.getByLabel("Motion style", { exact: true }).selectOption("clean");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByText("Project saved on this computer")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Project name")).toHaveValue(
    "Browser verification",
  );
  await expect(page.getByLabel("Subtitle 1 text")).toHaveValue(
    "Qualified leads",
  );
  await expect(page.getByLabel("Reviewed", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Export resolution")).toHaveValue("720");
  await expect(page.getByLabel("Clip 1 rotation")).toHaveValue("90");
  await page.getByRole("button", { name: "Brand & text", exact: true }).click();
  await expect(page.getByLabel("Motion style", { exact: true })).toHaveValue(
    "clean",
  );
  await page.getByRole("button", { name: "Subtitles", exact: true }).click();
  await expect(page.locator(".preview-frame video")).toHaveCSS(
    "transform",
    "matrix(0, 1, -1, 0, 0, 0)",
  );
  await page.getByLabel("Clip 1 start").fill("1");
  await expect(
    page.getByRole("button", { name: "Export both placements" }),
  ).toBeDisabled();
  await page.screenshot({
    path: ".local/test/studio-project.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: ".local/test/studio-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  // Uploaded media supports byte ranges for seeking during preview and rendering.
  const list = await (await request.get("/api/ads/projects")).json();
  const saved = await (
    await request.get(
      `/api/ads/projects/${list.find((p: { name: string }) => p.name === "Browser verification").id}`,
    )
  ).json();
  const media = saved.media[0] as Media;
  const partial = await request.get(`/api/ads/media/${media.file}`, {
    headers: { range: "bytes=0-99" },
  });
  expect(partial.status()).toBe(206);
  expect((await partial.body()).length).toBe(100);
});
