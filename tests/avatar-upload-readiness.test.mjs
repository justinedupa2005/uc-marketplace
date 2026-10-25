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
function compile(relativePath, overrides = {}, urlImplementation = URL) {
  const filename = path.join(root, relativePath);
  const nativeRequire = createRequire(filename);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", "URL", compiled)(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(name),
    compiledModule, compiledModule.exports, urlImplementation,
  );
  return compiledModule.exports;
}

const { Button } = compile("src/components/ui/button.tsx");
const { FieldError } = compile("src/components/ui/field-error.tsx");
const profileRules = compile("src/features/profiles/rules.ts");
const idle = { status: "idle", message: "" };
const filename = "src/features/profiles/components/avatar-upload.tsx";
const baseOverrides = {
  "@/components/ui/button": { Button },
  "@/components/ui/field-error": { FieldError },
  "@/features/profiles/components/profile-avatar": { ProfileAvatar: ({ avatarUrl }) => jsx("div", { "data-avatar-url": avatarUrl }) },
  "@/features/profiles/components/profile-feedback": { INITIAL_PROFILE_ACTION_STATE: idle, ProfileFeedback: () => null },
  "@/features/profiles/rules": profileRules,
};

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !node.props) return [];
  if (typeof node.type === "function") return elements(node.type(node.props));
  return [node, ...elements(node.props.children)];
}

const image = (name = "synthetic.png", type = "image/png", size = 3) =>
  new File([new Uint8Array(size)], name, { type });

function mountedAvatar({ hydrated = true, avatarUrl = null, uploadResult = { status: "success", message: "Synthetic success" } } = {}) {
  const states = [];
  const refs = [];
  const effects = [];
  const actionStates = [];
  const pending = [false, false];
  const created = [];
  const revoked = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  let actionIndex = 0;
  let uploadCalls = 0;
  const inputElement = { value: "", files: [] };
  const { AvatarUpload } = compile(filename, {
    ...baseOverrides,
    "@/features/profiles/actions": {
      async uploadAvatar() { uploadCalls += 1; return uploadResult; },
      async removeAvatar() { return { status: "success", message: "Synthetic removal" }; },
    },
    react: {
      useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
        assert.equal(typeof subscribe, "function");
        assert.equal(typeof subscribe(), "function");
        return hydrated ? getSnapshot() : getServerSnapshot();
      },
      useState(initialValue) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initialValue;
        return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
      useRef(initialValue) {
        const index = refIndex++;
        if (!(index in refs)) refs[index] = { current: initialValue };
        return refs[index];
      },
      useEffect(effect) {
        const index = effectIndex++;
        if (!(index in effects)) effects[index] = effect();
      },
      useActionState(action, initialState) {
        const index = actionIndex++;
        if (!(index in actionStates)) actionStates[index] = initialState;
        return [actionStates[index], async (formData) => {
          actionStates[index] = await action(actionStates[index], formData);
          return actionStates[index];
        }, pending[index]];
      },
    },
  }, {
    createObjectURL(file) {
      assert.ok(file instanceof File);
      const url = `blob:isolated-avatar-${created.length + 1}`;
      created.push(url);
      return url;
    },
    revokeObjectURL(url) { revoked.push(url); },
  });

  function render() {
    stateIndex = 0;
    refIndex = 0;
    effectIndex = 0;
    actionIndex = 0;
    const nodes = elements(AvatarUpload({ avatarUrl, fullName: "Synthetic student" }));
    const input = nodes.find((node) => node.type === "input" && node.props.type === "file");
    input.props.ref.current = inputElement;
    const forms = nodes.filter((node) => node.type === "form");
    return {
      input,
      save: nodes.find((node) => node.type === "button" && /Save Photo|Replace Photo|Uploading photo/.test(node.props.children)),
      cancel: nodes.find((node) => node.type === "button" && node.props.children === "Cancel"),
      remove: nodes.find((node) => node.type === "button" && /Remove Profile Photo|Removing photo/.test(node.props.children)),
      avatar: nodes.find((node) => Object.hasOwn(node.props, "data-avatar-url")),
      error: nodes.find((node) => node.props.id === "avatar-error"),
      uploadForm: forms[0],
      removeForm: forms[1],
    };
  }

  return {
    render, created, revoked, inputElement,
    get uploadCalls() { return uploadCalls; },
    hydrate() { hydrated = true; },
    setPending({ uploading = false, removing = false }) { pending[0] = uploading; pending[1] = removing; },
    select(file) {
      inputElement.files = file ? [file] : [];
      inputElement.value = file?.name ?? "";
      render().input.props.onChange({ target: inputElement });
      return render();
    },
    unmount() { for (const cleanup of effects) cleanup?.(); effects.length = 0; },
  };
}

test("actual AvatarUpload server markup disables file selection until hydration", () => {
  const { AvatarUpload } = compile(filename, {
    ...baseOverrides,
    "@/features/profiles/actions": {
      uploadAvatar() { assert.fail("SSR must not submit an avatar."); },
      removeAvatar() { assert.fail("SSR must not remove an avatar."); },
    },
  });
  const html = renderToStaticMarkup(jsx(AvatarUpload, { avatarUrl: null, fullName: "Synthetic student" }));
  const input = html.match(/<input\b[^>]*id="profile-avatar-file"[^>]*>/)?.[0];
  assert.ok(input, "The actual server output must include the avatar file input.");
  assert.match(input, /\sdisabled=""/);
  assert.match(html, /<button\b[^>]*disabled=""[^>]*>Save Photo<\/button>/);
});

test("hydration enables actual file selection, while both pending actions keep it disabled", () => {
  const fixture = mountedAvatar({ hydrated: false, avatarUrl: "https://synthetic.invalid/avatar.png" });
  assert.equal(fixture.render().input.props.disabled, true);
  fixture.hydrate();
  assert.equal(fixture.render().input.props.disabled, false);
  assert.equal(fixture.render().save.props.disabled, true, "Hydration alone is not a valid file selection.");
  assert.equal(fixture.select(image()).save.props.disabled, false);
  for (const action of [{ uploading: true }, { removing: true }, { uploading: true, removing: true }]) {
    fixture.setPending(action);
    const view = fixture.render();
    assert.equal(view.input.props.disabled, true);
    assert.equal(view.save.props.disabled, true);
    assert.equal(view.cancel.props.disabled, true);
    assert.equal(view.remove.props.disabled, true);
  }
  fixture.setPending({});
  assert.equal(fixture.render().input.props.disabled, false);
  assert.equal(fixture.render().save.props.disabled, false);
  fixture.unmount();
});

test("valid file selection enables save and cancel revokes and clears the actual preview", () => {
  const fixture = mountedAvatar();
  const selected = fixture.select(image());
  assert.equal(selected.save.props.disabled, false);
  assert.equal(selected.avatar.props["data-avatar-url"], fixture.created[0]);
  assert.equal(selected.error, undefined);
  selected.cancel.props.onClick();
  const cleared = fixture.render();
  assert.equal(cleared.save.props.disabled, true);
  assert.equal(cleared.cancel, undefined);
  assert.equal(cleared.avatar.props["data-avatar-url"], null);
  assert.equal(fixture.inputElement.value, "");
  assert.deepEqual(fixture.revoked, fixture.created);
  fixture.unmount();
  assert.equal(fixture.revoked.length, 1, "Unmount must not revoke an already-cleared preview twice.");
});

test("invalid file types, empty files and oversized files cannot enable upload or retain a stale preview", () => {
  for (const file of [image("synthetic.txt", "text/plain"), image("empty.png", "image/png", 0), image("large.png", "image/png", profileRules.MAX_AVATAR_BYTES + 1)]) {
    const fixture = mountedAvatar();
    fixture.select(image());
    const invalid = fixture.select(file);
    assert.equal(invalid.save.props.disabled, true);
    assert.equal(invalid.cancel, undefined);
    assert.equal(invalid.input.props["aria-invalid"], true);
    assert.equal(invalid.error.props.children, profileRules.getAvatarFileError(file));
    assert.equal(invalid.avatar.props["data-avatar-url"], null);
    assert.equal(fixture.inputElement.value, "");
    assert.equal(fixture.created.length, 1, "Invalid data must never receive a preview URL.");
    assert.deepEqual(fixture.revoked, fixture.created);
    fixture.unmount();
  }
});

test("replacement selection revokes its predecessor and unmount revokes the current preview", () => {
  const fixture = mountedAvatar();
  fixture.select(image("first.png"));
  fixture.select(image("second.webp", "image/webp"));
  assert.equal(fixture.created.length, 2);
  assert.deepEqual(fixture.revoked, [fixture.created[0]]);
  fixture.unmount();
  assert.deepEqual(fixture.revoked, fixture.created);
});

test("missing selection validation and clearing the file chooser keep save disabled", () => {
  const fixture = mountedAvatar();
  fixture.render().input.props.onInvalid();
  assert.equal(fixture.render().error.props.children, "Please choose a profile photo.");
  fixture.select(image());
  const cleared = fixture.select(null);
  assert.equal(cleared.save.props.disabled, true);
  assert.equal(cleared.error, undefined);
  assert.deepEqual(fixture.revoked, fixture.created);
});

test("completed upload actions clear selection and preview on both success and handled failure", async () => {
  for (const uploadResult of [{ status: "success", message: "Synthetic success" }, { status: "error", message: "Synthetic handled failure" }]) {
    const fixture = mountedAvatar({ uploadResult });
    const selected = fixture.select(image());
    assert.equal(await selected.uploadForm.props.action(new FormData()), uploadResult);
    const completed = fixture.render();
    assert.equal(fixture.uploadCalls, 1);
    assert.equal(completed.save.props.disabled, true);
    assert.equal(completed.cancel, undefined);
    assert.equal(completed.avatar.props["data-avatar-url"], null);
    assert.equal(fixture.inputElement.value, "");
    assert.deepEqual(fixture.revoked, fixture.created);
    fixture.unmount();
  }
});

test("submitting removal clears a newly selected preview before the actual removal action", () => {
  const fixture = mountedAvatar({ avatarUrl: "https://synthetic.invalid/avatar.png" });
  const selected = fixture.select(image());
  selected.removeForm.props.onSubmit();
  const cleared = fixture.render();
  assert.equal(cleared.save.props.disabled, true);
  assert.equal(cleared.avatar.props["data-avatar-url"], "https://synthetic.invalid/avatar.png");
  assert.equal(fixture.inputElement.value, "");
  assert.deepEqual(fixture.revoked, fixture.created);
});
