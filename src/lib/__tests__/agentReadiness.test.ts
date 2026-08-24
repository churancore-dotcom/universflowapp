import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LANDING_SSR_HEADING, LANDING_SSR_PARAGRAPHS } from "@/components/SsrLandingContent";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("agent readiness: no-JS landing content", () => {
  it("ships an H1 heading string", () => {
    expect(LANDING_SSR_HEADING.toLowerCase()).toContain("universflow");
  });

  it("ships 500+ characters of raw prose", () => {
    const chars = LANDING_SSR_PARAGRAPHS.join(" ").length;
    expect(chars).toBeGreaterThan(500);
  });
});

describe("agent readiness: llms.txt", () => {
  const llms = read("public/llms.txt");

  it("has a when-to-use section with concrete use cases", () => {
    expect(llms).toContain("## When to use this");
    expect(llms).toContain("offline listening");
  });

  it("tells agents how to call the service", () => {
    expect(llms).toContain("## How an agent should use it");
    expect(llms).toContain("https://universflow.in/search?q=QUERY");
    expect(llms).toContain("universflow.in@gmail.com");
  });
});

describe("agent readiness: sitemap includes trust anchors", () => {
  const sitemap = read("public/sitemap.xml");
  for (const path of ["/about", "/support", "/legal/privacy"]) {
    it(`lists ${path}`, () => {
      expect(sitemap).toContain(`https://universflow.in${path}<`);
    });
  }
});

describe("agent readiness: organization JSON-LD completeness", () => {
  const root = read("src/routes/__root.tsx");
  const json = root.slice(root.indexOf("const SCHEMA_GRAPH = JSON.stringify(") );
  it("includes url, logo, sameAs, address and contactPoint", () => {
    for (const key of ["sameAs", "contactPoint", "PostalAddress", "logo", "addressCountry"]) {
      expect(json).toContain(key);
    }
  });
});
