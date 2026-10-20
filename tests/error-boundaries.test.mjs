import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { jsx } from "react/jsx-runtime";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Compile and execute the real boundary modules and their retry controls.
// Unrelated profile navigation/logout are isolated to keep this unit check
// independent of router contexts, server actions, credentials and networks.
function compileComponent(relativePath, overrides = {}) {
  const filename = path.join(root, relativePath);
  const nativeRequire = createRequire(filename);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(name);
  new Function("require", "module", "exports", compiled)(localRequire, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

const { Button } = compileComponent("src/components/ui/button.tsx");
const { NotificationsErrorState } = compileComponent("src/features/notifications/components/notifications-error-state.tsx", {
  react: { useTransition: () => [false, (callback) => callback()] },
  "next/navigation": { useRouter: () => ({ refresh() { assert.fail("The supplied Next retry callback must be used instead of a fallback refresh."); } }) },
});

const overrides = {
  "@/components/ui/button": { Button },
  "@/components/navigation-blocker": { NavigationLink: (props) => jsx("a", props) },
  "@/features/profiles/components/logout-button": { LogoutButton: () => null },
  "@/features/notifications/components/notifications-error-state": { NotificationsErrorState },
};

function buttonsInTree(node) {
  if (Array.isArray(node)) return node.flatMap(buttonsInTree);
  if (!node || typeof node !== "object" || !node.props) return [];
  if (typeof node.type === "function") return buttonsInTree(node.type(node.props));
  return [
    ...(node.type === "button" ? [node] : []),
    ...buttonsInTree(node.props.children),
  ];
}

const boundaries = [
  "src/app/(marketplace)/error.tsx",
  "src/app/(marketplace)/admin/error.tsx",
  "src/app/(marketplace)/messages/[id]/error.tsx",
  "src/app/(marketplace)/notifications/error.tsx",
  "src/app/(marketplace)/profile/error.tsx",
  "src/app/(marketplace)/reservations/[reservationId]/error.tsx",
  "src/app/(marketplace)/users/[userId]/error.tsx",
];

for (const filename of boundaries) {
  test(`${filename} calls the framework retry callback from its real retry button`, () => {
    const ErrorBoundary = compileComponent(filename, overrides).default;
    let retries = 0;
    const tree = ErrorBoundary({ error: new Error("synthetic private failure"), retry: () => { retries += 1; } });
    const buttons = buttonsInTree(tree);
    assert.equal(buttons.length, 1, "A boundary must expose one retry control.");
    assert.equal(typeof buttons[0].props.onClick, "function");
    assert.notEqual(buttons[0].props.disabled, true);
    assert.equal(retries, 0, "Rendering must not start retries automatically.");
    buttons[0].props.onClick();
    assert.equal(retries, 1, "One activation must invoke the current framework retry callback once.");
    buttons[0].props.onClick();
    assert.equal(retries, 2, "Further activations must remain wired to the framework callback.");
  });
}
