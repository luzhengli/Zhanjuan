import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { injectDataSourceTags, zhanjuanVite } from "../bridge/vite-source-tag.mjs";

test("injectDataSourceTags tags lowercase intrinsic JSX elements and skips PascalCase/Fragments", () => {
  const src = `import React, { Fragment } from "react";

export function Box<T extends { id: string }>({ items }: { items: T[] }) {
  return (
    <>
      <Fragment>
        <section className="wrap">
          <CustomHeader title="Hi" />
          <button type="button" onClick={() => {}}>
            <span>Save</span>
          </button>
          <div data-source="keep-manual:1">Preserved</div>
        </section>
      </Fragment>
    </>
  );
}
`;
  const root = "/tmp/project";
  const file = "/tmp/project/src/Box.tsx";
  const out = injectDataSourceTags(src, file, { rootDir: root });
  assert.ok(out, "Expected transformed source");

  // Preserves exact line count
  assert.equal(out.split("\n").length, src.split("\n").length);

  // Intrinsic tags receive data-source with exact line numbers
  assert.match(out, /<section data-source="src\/Box\.tsx:7" className="wrap">/);
  assert.match(out, /<button data-source="src\/Box\.tsx:9" type="button"/);
  assert.match(out, /<span data-source="src\/Box\.tsx:10">Save<\/span>/);

  // Custom components and Fragments are untouched
  assert.match(out, /<CustomHeader title="Hi" \/>/);
  assert.match(out, /<Fragment>/);
  assert.doesNotMatch(out, /<Fragment data-source/);
  assert.doesNotMatch(out, /<CustomHeader data-source/);

  // Existing data-source is preserved and not duplicated
  assert.match(out, /<div data-source="keep-manual:1">Preserved<\/div>/);
  assert.equal(out.match(/data-source="keep-manual:1"/g)?.length, 1);
});

test("zhanjuanVite applies only in serve mode and mounts health probe", async () => {
  const plugin = zhanjuanVite({ project: "sample-app", mode: "fixtures", rootDir: process.cwd() });
  assert.equal(plugin.apply, "serve");

  plugin.configResolved({ command: "build", mode: "production", root: process.cwd() });
  assert.equal(plugin.transform("export const A = () => <div />;", path.join(process.cwd(), "src/A.tsx")), null);

  plugin.configResolved({ command: "serve", mode: "fixtures", root: process.cwd() });
  const res = plugin.transform("export const A = () => <div />;", path.join(process.cwd(), "src/A.tsx"));
  assert.ok(res && res.code.includes('data-source="src/A.tsx:1"'));

  // Test configureServer middleware
  let registeredRoute = "";
  let registeredHandler = null;
  plugin.configureServer({
    middlewares: {
      use(route, handler) {
        registeredRoute = route;
        registeredHandler = handler;
      },
    },
  });
  assert.equal(registeredRoute, "/__zhanjuan-health");
  assert.ok(registeredHandler);

  let body = "";
  let statusCode = 0;
  registeredHandler(
    { method: "GET" },
    {
      setHeader() {},
      set statusCode(code) {
        statusCode = code;
      },
      end(chunk) {
        body = String(chunk);
      },
    },
    () => {},
  );
  assert.equal(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.expectedProject, "sample-app");
  assert.equal(parsed.expectedMode, "fixtures");
  assert.ok(parsed.repoRoot);
  assert.ok(parsed.worktreePath);
});
