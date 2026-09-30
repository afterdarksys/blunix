// Live parts of blunix.io: the latest release, the release table, and whether the
// portal is open. Each part fills a region that already holds honest text, so the
// page still reads right with no JavaScript, and says one sentence when a load fails.
//
// Threats: markup or links injected through release text (everything is written
// with textContent, and a link is only made for an https://github.com URL of this
// repo), and a slow API holding the page (the portal check gives up after 3 s).

const REPO_URL = "https://github.com/afterdarksys/blunix/releases";
const LINK_OK = /^https:\/\/github\.com\/afterdarksys\/blunix\/releases\//;
const HEALTH = "https://api.blunix.io/v1/health";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}

function link(href, label) {
  if (typeof href !== "string" || !LINK_OK.test(href)) return document.createTextNode(label);
  return el("a", { href, text: label });
}

function repoLink(label) {
  return el("a", { href: REPO_URL, text: label });
}

export function size(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return "size unknown";
  const units = ["bytes", "KiB", "MiB", "GiB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return i === 0 ? `${n} bytes` : `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function day(iso) {
  const d = new Date(typeof iso === "string" ? iso : "");
  if (Number.isNaN(d.getTime())) return "date unknown";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function excerpt(body, max = 600) {
  const t = typeof body === "string" ? body.replace(/\r/g, "").trim() : "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = cut.lastIndexOf("\n");
  return (stop > max / 2 ? cut.slice(0, stop) : cut).trimEnd() + " …";
}

async function loadReleases() {
  const res = await fetch("/releases.json", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("status " + res.status);
  const data = await res.json();
  if (!data || !Array.isArray(data.releases)) throw new Error("shape");
  if (data.error && data.releases.length === 0) throw new Error(String(data.error));
  return data.releases.filter((r) => r && typeof r.tag === "string");
}

function assetList(assets) {
  const ul = el("ul", { class: "files" });
  for (const a of Array.isArray(assets) ? assets : []) {
    if (!a || typeof a.name !== "string") continue;
    const li = el("li");
    li.append(link(a.browser_download_url, a.name), document.createTextNode(", " + size(a.size) + "."));
    if (typeof a.sha256 === "string" && /^[0-9a-f]{64}$/.test(a.sha256)) {
      li.append(el("br"), document.createTextNode("sha256 "), el("code", { class: "sha", text: a.sha256 }));
    } else {
      li.append(el("br"), document.createTextNode("No sha256 was published for this file."));
    }
    ul.append(li);
  }
  if (!ul.children.length) ul.append(el("li", { text: "No files are attached to this release." }));
  return ul;
}

function done(region, ...nodes) {
  region.replaceChildren(...nodes);
  region.setAttribute("aria-busy", "false");
}

function failSentence() {
  return el("p", {}, document.createTextNode("The release list did not load just now, so this spot stays quiet. "),
    repoLink("Read the releases on GitHub"), document.createTextNode("."));
}

function emptySentence() {
  return el("p", {}, document.createTextNode("No release is published yet. The first one is being cut: an unsigned test image and the installer ISO. When it lands on GitHub, it shows up here without a redeploy. "),
    repoLink("The releases page on GitHub"), document.createTextNode(" is where it will be."));
}

function fillLatest(region, releases) {
  if (releases.length === 0) {
    done(region, emptySentence());
    return;
  }
  const r = releases[0];
  const head = el("h3", {}, link(r.html_url, r.name && r.name !== r.tag ? `${r.tag}, ${r.name}` : r.tag));
  const when = el("p", { class: "meta", text: `Published ${day(r.published_at)}.${r.prerelease ? " Marked as a pre-release." : ""}` });
  const nodes = [head, when];
  const notes = excerpt(r.body);
  if (notes) nodes.push(el("p", { class: "notes", text: notes }));
  nodes.push(el("h4", { text: "Files" }), assetList(r.assets));
  nodes.push(el("p", {}, document.createTextNode("Older releases are on the "), el("a", { href: "log.html", text: "log" }), document.createTextNode(".")));
  done(region, ...nodes);
}

function fillTable(region, releases) {
  if (releases.length === 0) {
    done(region, emptySentence());
    return;
  }
  const table = el("table");
  table.append(el("caption", { text: `Releases published on GitHub, newest first. ${releases.length === 1 ? "1 release" : releases.length + " releases"}.` }));
  const thead = el("thead");
  const hr = el("tr");
  for (const h of ["Release", "Published", "Files"]) hr.append(el("th", { scope: "col", text: h }));
  thead.append(hr);
  const tbody = el("tbody");
  for (const r of releases) {
    const tr = el("tr");
    const th = el("th", { scope: "row" }, link(r.html_url, r.tag));
    if (r.prerelease) th.append(el("br"), document.createTextNode("pre-release"));
    tr.append(th, el("td", { text: day(r.published_at) }), el("td", {}, assetList(r.assets)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  done(region, el("div", { class: "table-scroll" }, table));
}

async function releases() {
  const latest = $("release-latest");
  const table = $("release-table");
  if (!latest && !table) return;
  for (const r of [latest, table]) if (r) r.setAttribute("aria-busy", "true");
  let list;
  try {
    list = await loadReleases();
  } catch {
    for (const r of [latest, table]) if (r) done(r, failSentence());
    return;
  }
  if (latest) fillLatest(latest, list);
  if (table) fillTable(table, list);
}

async function portal() {
  const spots = document.querySelectorAll("[data-portal-status]");
  if (!spots.length) return;
  let open = false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(HEALTH, { signal: ctrl.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    const body = res.ok ? await res.json() : null;
    open = !!(body && body.ok === true);
  } catch {
    open = false;
  } finally {
    clearTimeout(timer);
  }
  for (const spot of spots) {
    const words = spot.querySelector("[data-portal-words]");
    if (words) words.textContent = open ? "The portal is open." : "The portal is not open yet.";
  }
}

if (typeof document !== "undefined") {
  releases();
  portal();
}
