import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function compile(relativePath, overrides = {}) {
  const filename = path.join(root, relativePath);
  const nativeRequire = createRequire(filename);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(name),
    compiledModule, compiledModule.exports,
  );
  return compiledModule.exports;
}

const searchParams = compile("src/features/listings/search-params.ts");
const defaultValues = { search: null, category: null, condition: null, minPrice: null, maxPrice: null, sort: "newest", page: 1 };

function mountedFilters({ values = defaultValues, priceRangeError = null, hydrated = true } = {}) {
  const state = [];
  let stateIndex = 0;
  const { MarketplaceFilters } = compile("src/features/listings/components/marketplace-filters.tsx", {
    react: {
      useId: () => ":isolated-filter-disclosure:",
      useState(initialValue) {
        const index = stateIndex++;
        if (!(index in state)) state[index] = initialValue;
        return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
      useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
        assert.equal(typeof subscribe, "function");
        assert.equal(typeof getSnapshot, "function");
        assert.equal(typeof getServerSnapshot, "function");
        return hydrated ? getSnapshot() : getServerSnapshot();
      },
    },
    "next/link": { default: (props) => jsx("a", props) },
    "next/navigation": { useRouter: () => ({ push() { assert.fail("Toggling a filter disclosure must not navigate or submit its form."); } }) },
    "@/features/listings/search-params": searchParams,
  });
  return {
    hydrate() { hydrated = true; },
    render() {
      stateIndex = 0;
      const wrapper = MarketplaceFilters({ values, priceRangeError });
      return wrapper.type(wrapper.props);
    },
  };
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...elements(node.props.children)];
}

function disclosure(tree) {
  const nodes = elements(tree);
  const button = nodes.find((node) => node.type === "button" && Object.hasOwn(node.props, "aria-expanded"));
  const panel = nodes.find((node) => node.props.id === button.props["aria-controls"]);
  return { nodes, button, panel };
}

test("actual filter component has one form and exposes desktop content independently of collapsed mobile state", () => {
  const { nodes, button, panel } = disclosure(mountedFilters().render());
  assert.equal(nodes.some((node) => node.type === "details" || node.type === "summary"), false);
  assert.equal(nodes.filter((node) => node.type === "form").length, 1);
  assert.equal(nodes.find((node) => node.type === "form").props["aria-label"], "Marketplace filters");
  assert.equal(button.props.type, "button");
  assert.equal(button.props["aria-expanded"], false);
  assert.match(button.props.className, /\bmd:hidden\b/);
  assert.match(panel.props.className, /^hidden /);
  assert.match(panel.props.className, /\bmd:block\b/);
  assert.equal(panel.props.hidden, undefined, "A native hidden container would defeat desktop visibility.");
  assert.equal(panel.props["aria-hidden"], undefined);
});

test("real server rendering disables mobile disclosure until its event handlers can hydrate", () => {
  const { MarketplaceFilters } = compile("src/features/listings/components/marketplace-filters.tsx", {
    "next/link": { default: (props) => jsx("a", props) },
    "next/navigation": { useRouter: () => ({ push() { assert.fail("Server rendering a disclosure must not navigate."); } }) },
    "@/features/listings/search-params": searchParams,
  });
  // Real React hooks and server renderer must select getServerSnapshot(), not
  // a mocked client snapshot that could conceal enabled, noninteractive HTML.
  const html = renderToStaticMarkup(jsx(MarketplaceFilters, { values: defaultValues }));
  const button = /<button\b[^>]*\baria-controls="([^"]+)"[^>]*>/.exec(html);
  assert.ok(button, "Server HTML must retain the disclosure's panel association.");
  assert.match(button[0], /\sdisabled=""/);
  assert.match(button[0], /aria-expanded="false"/);
  assert.equal((html.match(/<form\b/g) ?? []).length, 1);
  assert.ok(html.includes(`id="${button[1]}"`));
  assert.match(html, /class="hidden [^"]*md:block/);
});

test("initial hydration snapshot stays disabled and the hydrated disclosure enables without replacing its panel or form", () => {
  const fixture = mountedFilters({ hydrated: false });
  const initial = disclosure(fixture.render());
  assert.equal(initial.button.props.disabled, true);
  assert.equal(initial.button.props["aria-expanded"], false);
  assert.equal(initial.nodes.filter((node) => node.type === "form").length, 1);
  const panelId = initial.panel.props.id;
  fixture.hydrate();
  const hydrated = disclosure(fixture.render());
  assert.equal(hydrated.button.props.disabled, false);
  assert.equal(hydrated.panel.props.id, panelId);
  assert.equal(hydrated.button.props["aria-controls"], panelId);
  assert.equal(hydrated.button.props["aria-expanded"], false);
  hydrated.button.props.onClick();
  const opened = disclosure(fixture.render());
  assert.equal(opened.button.props.disabled, false);
  assert.equal(opened.button.props["aria-expanded"], true);
  assert.equal(opened.panel.props.id, panelId);
  assert.match(opened.panel.props.className, /^block /);
  assert.equal(opened.nodes.filter((node) => node.type === "form").length, 1);
  opened.button.props.onClick();
  const closed = disclosure(fixture.render());
  assert.equal(closed.button.props.disabled, false);
  assert.equal(closed.button.props["aria-expanded"], false);
  assert.equal(closed.panel.props.id, panelId);
  assert.match(closed.panel.props.className, /^hidden /);
});

test("actual disclosure control toggles mobile state, keeps stable association and never duplicates its form", () => {
  const fixture = mountedFilters();
  const initial = disclosure(fixture.render());
  const panelId = initial.panel.props.id;
  initial.button.props.onClick();
  const opened = disclosure(fixture.render());
  assert.equal(opened.button.props["aria-expanded"], true);
  assert.equal(opened.panel.props.id, panelId);
  assert.match(opened.panel.props.className, /^block /);
  assert.equal(opened.nodes.filter((node) => node.type === "form").length, 1);
  opened.button.props.onClick();
  const closed = disclosure(fixture.render());
  assert.equal(closed.button.props["aria-expanded"], false);
  assert.equal(closed.panel.props.id, panelId);
  assert.match(closed.panel.props.className, /^hidden /);
  assert.match(closed.panel.props.className, /\bmd:block\b/);
});

test("disclosure state preserves query defaults, filters and price-validation feedback", () => {
  const values = { ...defaultValues, search: "calculator", condition: "good", minPrice: "500", maxPrice: "700", sort: "price-asc" };
  const fixture = mountedFilters({ values, priceRangeError: searchParams.MARKETPLACE_PRICE_RANGE_ERROR });
  const before = disclosure(fixture.render());
  before.button.props.onClick();
  const after = disclosure(fixture.render());
  const form = after.nodes.find((node) => node.type === "form");
  assert.equal(form.props.action, "/marketplace");
  assert.equal(form.props.method, "get");
  for (const [id, value] of [["marketplace-condition", "good"], ["marketplace-min-price", "500"], ["marketplace-max-price", "700"]]) {
    assert.equal(after.nodes.find((node) => node.props.id === id).props.defaultValue, value);
  }
  assert.equal(after.nodes.find((node) => node.props.name === "search").props.value, values.search);
  assert.equal(after.nodes.find((node) => node.props.name === "sort").props.value, values.sort);
  assert.equal(after.nodes.find((node) => node.props.role === "alert").props.children, searchParams.MARKETPLACE_PRICE_RANGE_ERROR);
});
