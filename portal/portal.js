// The blunix portal. Talks to the API with the session cookie, composes the
// node document, makes the key, and encrypts with age in this browser.
//
// Threats: the key leaving the browser, a cross-site request riding the
// session, a server that reads or swaps a document, and markup injected from
// an API response. The key is never stored, logged, put in a URL, or sent in
// a request. Every state-changing call carries x-blunix-csrf. API text is
// written with textContent only. A digest mismatch shows no install card.

import { Encrypter, armor } from "./vendor/age-encryption.js";
import {
  PACKAGES, shareableRecipe, buildNode, displayKey, generateKey, hex, installBundle, installCardText,
  keyGroups, labelProblem, latestUrl, MAX_CIPHER, pinnedUrl, spellGroup, validVersion,
} from "./lib.js";

// The page names its API. scripts/serve-portal-dev.py swaps it, and the CSP, for a
// local Worker. The deployed page names only https://api.blunix.io.
const API = document.querySelector('meta[name="blunix-api"]')?.content || "https://api.blunix.io/v1";

const $ = (id) => document.getElementById(id);

// ---- status and field problems --------------------------------------------

let statusTimer = 0;
function say(message) {
  const el = $("status");
  el.textContent = "";
  clearTimeout(statusTimer);
  // A short gap so the same sentence twice is announced twice.
  statusTimer = setTimeout(() => { el.textContent = message; }, 50);
}

function setProblem(fieldId, message) {
  const field = $(fieldId);
  const problem = $(fieldId + "-problem");
  if (!problem) return;
  if (message) {
    problem.textContent = message;
    problem.hidden = false;
    if (field && field.tagName !== "FIELDSET") field.setAttribute("aria-invalid", "true");
  } else {
    problem.textContent = "";
    problem.hidden = true;
    if (field) field.removeAttribute("aria-invalid");
  }
}

// ---- API -------------------------------------------------------------------

class SignedOut extends Error {}

async function api(method, path, { json, bytes } = {}) {
  const headers = { accept: "application/json" };
  let body;
  if (method !== "GET" && method !== "HEAD") headers["x-blunix-csrf"] = "1";
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (bytes !== undefined) {
    headers["content-type"] = "application/octet-stream";
    body = bytes;
  }
  let res;
  try {
    res = await fetch(API + path, {
      method, headers, body,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return { ok: false, status: 0, data: null };
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401) throw new SignedOut();
  return { ok: res.ok, status: res.status, data };
}

// The server's error strings are fixed. Show them as text, never as markup.
function why(r) {
  if (r.status === 0) return "The API did not answer.";
  const e = r.data && typeof r.data.error === "string" ? r.data.error : "";
  const clean = e.replace(/[^\x20-\x7e]/g, "").slice(0, 120);
  return clean ? "The server said: " + clean + "." : "The server answered " + r.status + ".";
}

function enc(label) {
  return encodeURIComponent(label);
}

// ---- state -----------------------------------------------------------------

let hosts = [];

function signedOut(message) {
  $("signed-in").hidden = true;
  $("signed-out").hidden = false;
  wipeCard();
  wipeMinted();
  hosts = [];
  setSelected(null);
  $("configurations").replaceChildren();
  $("admin-key").value = "";
  $("install-erase").checked = false;
  say(message || "blunix: signed out.");
}

async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SignedOut) {
      signedOut("blunix: you are signed out. Sign in again.");
      return undefined;
    }
    say("blunix: something failed in this page. Nothing else was sent.");
    return undefined;
  }
}

function accountName(me) {
  const a = me && me.account;
  if (!a || typeof a !== "object") return "an account";
  for (const k of ["email", "name", "preferred_username", "sub", "id"]) {
    if (typeof a[k] === "string" && a[k]) return a[k];
  }
  return "an account";
}

async function start() {
  $("login").href = API + "/auth/login";
  let me;
  try {
    me = await api("GET", "/me");
  } catch (err) {
    if (err instanceof SignedOut) { signedOut("blunix: not signed in."); return; }
    throw err;
  }
  if (!me.ok) {
    signedOut(me.status === 0 ? "blunix: the API did not answer. Sign in when it is back." : "blunix: not signed in.");
    return;
  }
  $("signed-out").hidden = true;
  $("signed-in").hidden = false;
  $("who").textContent = "Signed in as " + accountName(me.data) + ".";
  await loadHosts();
  await loadKeys();
  await loadConfigurations();
  renderPreview();
  say("blunix: signed in. " + countSentence(hosts.length));
}

function countSentence(n) {
  return n === 1 ? "1 hostname." : n + " hostnames.";
}

// ---- hostnames -------------------------------------------------------------

function normalizeHosts(data) {
  const list = Array.isArray(data) ? data : (data && (data.hosts || data.labels)) || [];
  const out = [];
  for (const item of list) {
    const label = typeof item === "string" ? item : item && item.label;
    if (typeof label !== "string" || labelProblem(label)) continue;
    let latest = item && (item.latest ?? item.latestVersion ?? item.version);
    if (latest && typeof latest === "object") latest = latest.version;
    out.push({ label, latest: validVersion(latest) ? latest : null });
  }
  return out;
}

async function loadHosts() {
  const r = await api("GET", "/hosts");
  if (!r.ok) {
    say("blunix: could not list hostnames. " + why(r));
    return;
  }
  hosts = normalizeHosts(r.data);
  renderHosts();
}

function button(text, onClick, quiet) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = quiet ? "button quiet small" : "button small";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function renderHosts() {
  const ul = $("hosts");
  ul.replaceChildren();
  $("hosts-empty").hidden = hosts.length > 0;
  for (const h of hosts) {
    const li = document.createElement("li");
    const head = document.createElement("h3");
    head.textContent = h.label;
    const p = document.createElement("p");
    const host = document.createElement("span");
    host.className = "host";
    host.textContent = h.label + ".blnx.io";
    p.append(host, document.createTextNode(
      h.latest ? ". Latest is version " + h.latest + "." : ". No build yet. It serves 404."));
    const versions = document.createElement("div");
    versions.id = "versions-" + h.label;
    versions.className = "versions";
    versions.hidden = true;
    const actions = document.createElement("div");
    actions.className = "actions";
    const show = button("Versions of " + h.label, () => guarded(() => toggleVersions(h.label, show)), true);
    show.setAttribute("aria-expanded", "false");
    show.setAttribute("aria-controls", versions.id);
    actions.append(
      button("Build for " + h.label, () => chooseBuild(h.label)),
      show,
      button("Release " + h.label, () => guarded(() => releaseLabel(h.label)), true),
    );
    li.append(head, p, actions, versions);
    ul.append(li);
  }
  const sel = $("build-label");
  const current = sel.value;
  sel.replaceChildren();
  for (const h of hosts) {
    const o = document.createElement("option");
    o.value = h.label;
    o.textContent = h.label + ".blnx.io";
    sel.append(o);
  }
  if (hosts.some((h) => h.label === current)) sel.value = current;
  $("build-submit").disabled = hosts.length === 0;
  renderPreview();
}

function chooseBuild(label) {
  $("build-label").value = label;
  renderPreview();
  $("build-label").focus();
  say("blunix: building for " + label + ".");
}

async function toggleVersions(label, btn) {
  const box = $("versions-" + label);
  if (!box.hidden) {
    box.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    return;
  }
  const r = await api("GET", "/hosts/" + enc(label));
  if (!r.ok) {
    say("blunix: could not read " + label + ". " + why(r));
    return;
  }
  const list = (r.data && Array.isArray(r.data.versions)) ? r.data.versions : [];
  box.replaceChildren();
  const h = document.createElement("h4");
  h.textContent = "Versions of " + label;
  box.append(h);
  if (list.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No versions.";
    box.append(p);
  } else {
    const ul = document.createElement("ul");
    ul.className = "rows";
    for (const v of list) {
      if (!v || !validVersion(v.version)) continue;
      const li = document.createElement("li");
      const p = document.createElement("p");
      p.append(document.createTextNode("Version " + v.version + ". "));
      // Shown only when the API names it: no pinned host without a certificate.
      if (v.pinnedUrl === pinnedUrl(label, v.version)) {
        const url = document.createElement("span");
        url.className = "host";
        url.textContent = v.pinnedUrl;
        p.append(url);
      }
      const meta = [];
      if (typeof v.size === "number") meta.push(v.size + " bytes");
      if (typeof v.created === "string" || typeof v.created === "number") meta.push("created " + String(v.created).slice(0, 40));
      if (typeof v.sha256 === "string" && /^[0-9a-f]{64}$/.test(v.sha256)) meta.push("sha256 " + v.sha256);
      if (meta.length) p.append(document.createTextNode(". " + meta.join(", ") + "."));
      li.append(p, button("Delete version " + v.version + " of " + label,
        () => guarded(() => deleteVersion(label, v.version)), true));
      ul.append(li);
    }
    box.append(ul);
  }
  box.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  say("blunix: " + label + " has " + (list.length === 1 ? "1 version." : list.length + " versions."));
}

async function deleteVersion(label, n) {
  if (!confirm("Delete version " + n + " of " + label + "? It stops serving now.")) return;
  const r = await api("DELETE", "/hosts/" + enc(label) + "/builds/" + n);
  if (!r.ok) {
    say("blunix: could not delete version " + n + " of " + label + ". " + why(r));
    return;
  }
  await loadHosts();
  const btn = document.querySelector('[aria-controls="versions-' + label + '"]');
  if (btn) await toggleVersions(label, btn);
  if (btn) btn.focus();
  say("blunix: deleted version " + n + " of " + label + ".");
}

async function releaseLabel(label) {
  if (!confirm("Release " + label + "? Every version stops serving. The name is held for 30 days.")) return;
  const r = await api("DELETE", "/hosts/" + enc(label));
  if (!r.ok) {
    say("blunix: could not release " + label + ". " + why(r));
    return;
  }
  await loadHosts();
  $("hosts-h").setAttribute("tabindex", "-1");
  $("hosts-h").focus();
  say("blunix: released " + label + ".");
}

// ---- reserve ---------------------------------------------------------------

function onReserveInput() {
  const v = $("reserve-label").value;
  $("reserve-preview").textContent = (v || "label") + ".blnx.io";
  setProblem("reserve-label", v === "" ? null : labelProblem(v));
}

async function onReserve(ev) {
  ev.preventDefault();
  const input = $("reserve-label");
  const label = input.value;
  const problem = labelProblem(label);
  setProblem("reserve-label", problem);
  if (problem) {
    input.focus();
    say("blunix: " + problem);
    return;
  }
  say("blunix: reserving " + label + ".");
  const r = await api("POST", "/hosts", { json: { label } });
  if (r.status === 409) {
    setProblem("reserve-label", label + " is taken.");
    input.focus();
    say("blunix: " + label + " is taken.");
    return;
  }
  if (!r.ok) {
    const msg = "Could not reserve " + label + ". " + why(r);
    setProblem("reserve-label", msg);
    input.focus();
    say("blunix: " + msg);
    return;
  }
  input.value = "";
  onReserveInput();
  await loadHosts();
  $("build-label").value = label;
  renderPreview();
  say("blunix: reserved " + label + ".");
}

// ---- build -----------------------------------------------------------------

const BUILD_FIELDS = ["build-label", "build-hostname", "build-disk", "build-network",
  "build-match", "build-address", "build-gateway", "build-dns", "build-access", "build-packages", "build-admin", "build-install", "build-form"];

function readBuild() {
  const f = $("build");
  const label = $("build-label").value;
  const netmode = f.querySelector('input[name="netmode"]:checked');
  const disk = f.querySelector('input[name="disk"]:checked');
  return {
    label,
    hostname: $("build-hostname").value.trim() || label,
    disk: disk ? disk.value : "",
    access: $("build-access").value,
    packages: [...document.querySelectorAll('input[name="package"]:checked')].map(el => el.value),
    target: $("install-target").value.trim(),
    install: { erase: $("install-erase").checked, reboot: $("install-reboot").checked },
    admin: { name: $("admin-name").value.trim(), sshPublicKey: $("admin-key").value.trim().split(/\s+/).slice(0, 2).join(" ") },
    network: {
      mode: netmode ? netmode.value : "",
      match: $("build-match").value,
      address: $("build-address").value,
      gateway: $("build-gateway").value,
      dns: $("build-dns").value,
    },
  };
}

function renderPreview() {
  const f = $("build");
  const netmode = f.querySelector('input[name="netmode"]:checked');
  $("static-fields").hidden = !(netmode && netmode.value === "static");
  const input = readBuild();
  if (!input.label) {
    $("preview-code").textContent = "# Reserve a hostname first.";
    return null;
  }
  const out = buildNode(input);
  $("preview-code").textContent = out.yaml || "# Not valid yet: " + Object.values(out.errors)[0];
  return out;
}

const ERROR_FIELD = {
  label: "build-label", hostname: "build-hostname", disk: "build-disk", network: "build-network",
  match: "build-match", address: "build-address", gateway: "build-gateway", dns: "build-dns",
  access: "build-access", packages: "build-packages", admin: "build-admin", install: "build-install", form: "build-form",
};

let building = false;

async function onBuild(ev) {
  ev.preventDefault();
  if (building) return;
  for (const id of BUILD_FIELDS) setProblem(id, null);
  const input = readBuild();
  const out = buildNode(input);
  $("preview-code").textContent = out.yaml || "# Not valid yet.";
  if (out.errors) {
    let first = null;
    for (const [k, msg] of Object.entries(out.errors)) {
      const id = ERROR_FIELD[k] || "build-form";
      setProblem(id, msg);
      if (!first) first = id;
    }
    const n = Object.keys(out.errors).length;
    const el = $(first);
    const target = !el ? $("build-submit") : el.tagName === "FIELDSET" ? el.querySelector("input") : el;
    if (target) target.focus();
    say("blunix: the document has " + (n === 1 ? "1 problem. " : n + " problems. ") + Object.values(out.errors)[0]);
    return;
  }
  building = true;
  const submit = $("build-submit");
  submit.disabled = true;
  wipeCard();
  let key = null;
  try {
    key = generateKey();
    say("blunix: encrypting the build for " + input.label + ".");
    const e = new Encrypter();
    e.setPassphrase(key);
    const cipher = await e.encrypt(out.yaml);
    if (!(cipher instanceof Uint8Array) || cipher.length === 0 || cipher.length > MAX_CIPHER) {
      setProblem("build-form", "The encrypted document is larger than 256 KiB. Nothing was uploaded.");
      say("blunix: the encrypted document is too large. Nothing was uploaded.");
      return;
    }
    const digest = hex(await crypto.subtle.digest("SHA-256", cipher));
    say("blunix: uploading the build for " + input.label + ".");
    const r = await api("POST", "/hosts/" + enc(input.label) + "/builds", { bytes: cipher });
    if (!r.ok) {
      const msg = "Could not publish to " + input.label + ". " + why(r) + " The key was discarded.";
      setProblem("build-form", msg);
      say("blunix: " + msg);
      return;
    }
    const d = r.data || {};
    if (!validVersion(d.version) || d.sha256 !== digest) {
      const msg = "The server's answer does not match what this browser sent. No install card is shown. Delete that version and publish again.";
      setProblem("build-form", msg);
      say("blunix: " + msg);
      await loadHosts();
      return;
    }
    showCard({
      label: input.label,
      version: d.version,
      pinned: d.pinnedUrl === pinnedUrl(input.label, d.version) ? d.pinnedUrl : null,
      key,
      sha256: digest,
      armored: armor.encode(cipher),
      date: new Date().toISOString().slice(0, 10),
    });
    say("blunix: build " + d.version + " published.");
    await loadHosts();
  } finally {
    key = null;
    building = false;
    submit.disabled = hosts.length === 0;
  }
}

// ---- install card ----------------------------------------------------------

// Held only while the card is open. Cleared when it closes, on sign out, and
// before the next build.
let card = null;

function showCard(c) {
  card = c;
  $("card-h").textContent = "Install card for " + c.label + ", version " + c.version;
  $("card-latest").textContent = latestUrl(c.label);
  $("card-pinned").textContent = c.pinned ?? "";
  $("card-pinned-row").hidden = c.pinned === null;
  $("card-sha").textContent = c.sha256;
  $("card-date").textContent = c.date;
  const ol = $("card-key");
  ol.replaceChildren();
  keyGroups(c.key).forEach((g, i) => {
    const li = document.createElement("li");
    const seen = document.createElement("span");
    seen.className = "group";
    seen.setAttribute("aria-hidden", "true");
    seen.textContent = g;
    const heard = document.createElement("span");
    heard.className = "sr-only";
    heard.textContent = "Group " + (i + 1) + ": " + spellGroup(g) + ".";
    li.append(seen, heard);
    ol.append(li);
  });
  $("card").hidden = false;
  $("card-h").focus();
}

function wipeCard() {
  card = null;
  $("card").hidden = true;
  $("card-key").replaceChildren();
  for (const id of ["card-latest", "card-pinned", "card-sha", "card-date"]) $(id).textContent = "";
  $("card-pinned-row").hidden = true;
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    say("blunix: " + what + " copied.");
  } catch {
    say("blunix: this browser did not allow copying. Download the install card instead.");
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onDownloadCard() {
  if (!card) return;
  const name = card.label + "-v" + card.version + "-install.txt";
  download(name, installCardText(card), "text/plain;charset=utf-8");
  say("blunix: saved " + name + ".");
}

function onDownloadBundle() {
  if (!card) return;
  const name = card.label + "-v" + card.version + ".json";
  download(name, installBundle(card), "application/json");
  say("blunix: saved " + name + ". It holds the ciphertext, not the key.");
}

function onCloseCard() {
  const label = card ? card.label : "";
  wipeCard();
  $("build-h").setAttribute("tabindex", "-1");
  $("build-h").focus();
  say("blunix: install card closed" + (label ? " for " + label : "") + ". The key is gone from this page.");
}

// ---- API keys --------------------------------------------------------------

let minted = null;

function normalizeKeys(data) {
  const list = Array.isArray(data) ? data : (data && data.keys) || [];
  return list.filter((k) => k && typeof k.fingerprint === "string" && /^[A-Za-z0-9_:=-]{1,128}$/.test(k.fingerprint));
}

async function loadKeys() {
  const r = await api("GET", "/keys");
  if (!r.ok) {
    say("blunix: could not list API keys. " + why(r));
    return;
  }
  const keys = normalizeKeys(r.data);
  const ul = $("keys");
  ul.replaceChildren();
  $("keys-empty").hidden = keys.length > 0;
  for (const k of keys) {
    const li = document.createElement("li");
    const p = document.createElement("p");
    const name = typeof k.name === "string" && k.name ? k.name : "unnamed";
    const scopes = Array.isArray(k.scopes) ? k.scopes.filter((s) => typeof s === "string").join(", ") : "";
    p.append(document.createTextNode(name + ". "));
    const fp = document.createElement("code");
    fp.textContent = k.fingerprint;
    p.append(fp, document.createTextNode(scopes ? ". Scope " + scopes + "." : "."));
    li.append(p, button("Revoke " + name, () => guarded(() => revokeKey(k.fingerprint, name)), true));
    ul.append(li);
  }
}

async function onMint(ev) {
  ev.preventDefault();
  const name = $("mint-name").value.trim();
  if (!/^[\x20-\x7e]{1,64}$/.test(name)) {
    setProblem("mint-name", "Name the key, such as proxy. Plain characters, at most 64.");
    $("mint-name").focus();
    say("blunix: name the key first.");
    return;
  }
  setProblem("mint-name", null);
  const scope = $("mint-scope").value;
  const r = await api("POST", "/keys", { json: { name, scopes: [scope] } });
  if (!r.ok || !r.data || typeof r.data.key !== "string" || !/^blx_[A-Za-z0-9_-]{43}$/.test(r.data.key)) {
    const msg = "Could not mint a key. " + (r.ok ? "The answer was not a key." : why(r));
    setProblem("mint-name", msg);
    say("blunix: " + msg);
    return;
  }
  minted = r.data.key;
  $("minted-key").textContent = minted;
  $("minted-fp").textContent = typeof r.data.fingerprint === "string" ? r.data.fingerprint : "";
  $("minted").hidden = false;
  $("mint-name").value = "";
  $("minted-h").focus();
  say("blunix: minted key " + name + ".");
  await loadKeys();
}

function wipeMinted() {
  minted = null;
  $("minted").hidden = true;
  $("minted-key").textContent = "";
  $("minted-fp").textContent = "";
}

async function revokeKey(fingerprint, name) {
  if (!confirm("Revoke " + name + "? Programs using it stop now.")) return;
  const r = await api("DELETE", "/keys/" + encodeURIComponent(fingerprint));
  if (!r.ok) {
    say("blunix: could not revoke " + name + ". " + why(r));
    return;
  }
  await loadKeys();
  $("keylist-h").setAttribute("tabindex", "-1");
  $("keylist-h").focus();
  say("blunix: revoked " + name + ".");
}

// ---- sign out --------------------------------------------------------------

async function onLogout() {
  try {
    await api("POST", "/auth/logout");
  } catch (err) {
    if (!(err instanceof SignedOut)) throw err;
  }
  signedOut("blunix: signed out.");
  $("login").focus();
}

// ---- wire up ---------------------------------------------------------------

function wire() {
  $("reserve-label").addEventListener("input", onReserveInput);
  $("reserve").addEventListener("submit", (e) => guarded(() => onReserve(e)));
  $("build").addEventListener("input", renderPreview);
  $("build").addEventListener("change", renderPreview);
  $("build").addEventListener("submit", (e) => guarded(() => onBuild(e)));
  $("copy-key").addEventListener("click", () => card && copyText(displayKey(card.key), "key"));
  $("dl-card").addEventListener("click", onDownloadCard);
  $("dl-bundle").addEventListener("click", onDownloadBundle);
  $("close-card").addEventListener("click", onCloseCard);
  $("mint").addEventListener("submit", (e) => guarded(() => onMint(e)));
  $("copy-minted").addEventListener("click", () => minted && copyText(minted, "API key"));
  $("close-minted").addEventListener("click", () => { wipeMinted(); $("mint-name").focus(); say("blunix: API key hidden."); });
  $("logout").addEventListener("click", () => guarded(onLogout));
  // Leaving the page drops the key with it. Do not keep it in bfcache.
  window.addEventListener("pagehide", () => { wipeCard(); wipeMinted(); });
}



// ---- Reusable configuration library ----------------------------------------
let selectedConfiguration = null;
let ownOffset = null;
let communityOffset = null;

function recipeFromForm() { return shareableRecipe(readBuild()); }
function useRecipe(recipe) {
  const safe = shareableRecipe(recipe);
  $("build-access").value = safe.access;
  for (const input of document.querySelectorAll('input[name="package"]')) input.checked = safe.packages.includes(input.value);
  renderPreview();
}
function setSelected(c) {
  selectedConfiguration = c;
  $("configuration-revise").disabled = !c;
  $("configuration-editing").textContent = c ? "Editing " + c.title + ", based on revision " + c.revision + "." : "No saved configuration selected.";
}
function wireConfigurations() {
  for (const name of PACKAGES) {
    const label = document.createElement("label"); label.className = "choice";
    const input = document.createElement("input"); input.type = "checkbox"; input.name = "package"; input.value = name;
    label.append(input, document.createTextNode(" " + name)); $("package-choices").append(label);
  }
  $("configuration-save").addEventListener("click", () => guarded(() => saveConfiguration(false)));
  $("configuration-revise").addEventListener("click", () => guarded(() => saveConfiguration(true)));
  $("configurations-more").addEventListener("click", () => guarded(() => loadConfigurations(ownOffset)));
  $("community-more").addEventListener("click", () => guarded(() => loadCommunity(communityOffset)));
}
async function saveConfiguration(revise) {
  const recipe = recipeFromForm();
  const c = selectedConfiguration;
  if (revise && !c) return;
  const r = await api("POST", revise ? "/configurations/" + c.id + "/revisions" : "/configurations", {
    json: revise ? { recipe, revision: c.revision, message: $("configuration-message").value } : { recipe, title: $("configuration-title").value },
  });
  if (!r.ok) { say("blunix: configuration was not saved. " + why(r)); return; }
  setSelected({ id: r.data.id, revision: r.data.revision, title: revise ? c.title : $("configuration-title").value });
  await loadConfigurations(); await loadCommunity();
  say("blunix: saved configuration revision " + r.data.revision + ".");
}
async function loadConfigurations(offset = 0) {
  const r = await api("GET", "/configurations?offset=" + (offset || 0));
  if (!r.ok) { say("blunix: could not load configurations. " + why(r)); return; }
  if (!offset) $("configurations").replaceChildren();
  for (const c of r.data.configurations) renderConfiguration(c, false);
  ownOffset = r.data.nextOffset; $("configurations-more").hidden = ownOffset === null;
}
async function loadCommunity(offset = 0) {
  const r = await api("GET", "/community?offset=" + (offset || 0));
  if (!r.ok) { $("community").textContent = "Community configurations are currently unavailable."; return; }
  if (!offset) $("community").replaceChildren();
  for (const c of r.data.configurations) renderConfiguration(c, true);
  if (!offset && !r.data.configurations.length) $("community").textContent = "No public configurations yet. Share a configuration to start the library.";
  communityOffset = r.data.nextOffset; $("community-more").hidden = communityOffset === null;
}
function renderConfiguration(c, publicView) {
  const li = document.createElement("li"), h = document.createElement("h3"), p = document.createElement("p"), detail = document.createElement("div");
  h.textContent = c.title; p.textContent = "Revision " + c.revision + ". " + c.visibility + ".";
  if (c.source) p.append(document.createTextNode(" Fork of " + c.source.id + ", revision " + c.source.revision + "."));
  li.append(h, p, button("View revisions", () => guarded(async () => {
    const r = await api("GET", (publicView ? "/community/" : "/configurations/") + c.id);
    if (!r.ok) { say(why(r)); return; }
    detail.replaceChildren();
    for (const rev of r.data.revisions) {
      const row = document.createElement("p"), code = document.createElement("code");
      code.textContent = "Revision " + rev.revision + ": " + rev.recipe.packages.join(", ") + "; access: " + rev.recipe.access + ". " + rev.message;
      row.append(code, document.createTextNode(" "), button(publicView ? "Fork revision " + rev.revision : "Use revision " + rev.revision, () => guarded(async () => {
        if (publicView) {
          const fork = await api("POST", "/configurations", { json: { title: c.title, source: { id: c.id, revision: rev.revision } } });
          if (!fork.ok) { say(why(fork)); return; }
          setSelected({ ...fork.data, title: c.title }); await loadConfigurations();
        } else {
          // Saving after restoring history still compares with the current head.
          setSelected({ ...c, revision: r.data.revision });
        }
        useRecipe(rev.recipe); $("configuration-title").value = c.title;
        $("build-access").focus(); say("blunix: configuration loaded. Add your personal installation settings before publishing a build.");
      }), true));
      detail.append(row);
    }
  }), true), detail);
  if (!publicView) {
    li.append(button(c.visibility === "public" ? "Make private" : "Share publicly", () => guarded(async () => {
      const visibility = c.visibility === "public" ? "private" : "public";
      if (visibility === "public" && !confirm("Publish every revision of this configuration for other members to use and adapt? Titles and revision notes become public too. Others can keep copies.")) return;
      const r = await api("POST", "/configurations/" + c.id + "/publication", { json: { visibility } });
      if (!r.ok) { say(why(r)); return; }
      await loadConfigurations(); await loadCommunity(); say("blunix: configuration is " + visibility + ".");
    }), true));
    li.append(button("Delete configuration", () => guarded(async () => {
      if (!confirm("Delete this configuration and remove it from the community? Copies others made remain theirs.")) return;
      const r = await api("DELETE", "/configurations/" + c.id);
      if (!r.ok) { say(why(r)); return; }
      if (selectedConfiguration?.id === c.id) setSelected(null);
      await loadConfigurations(); await loadCommunity(); say("blunix: configuration deleted.");
    }), true));
  } else {
    li.append(button("Report abuse", () => guarded(async () => {
      if (!confirm("Report this configuration for review by the maintainers?")) return;
      const r = await api("POST", "/community/" + c.id + "/reports", { json: { reason: "abuse" } });
      say(r.ok ? "blunix: report recorded for review." : why(r));
    }), true));
  }
  $(publicView ? "community" : "configurations").append(li);
}

wire();
wireConfigurations();
guarded(start);
guarded(() => loadCommunity());
