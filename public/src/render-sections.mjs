export const SECTION_MARKERS = Object.freeze({
  header: "<!--dv:header-->",
  view: "<!--dv:view-->",
  modals: "<!--dv:modals-->",
});

function sectionSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) return null;

  return source.slice(start + startMarker.length, end);
}

export function splitLegacyHtml(html) {
  const source = String(html || "");
  const header = sectionSlice(source, SECTION_MARKERS.header, SECTION_MARKERS.view);
  const view = sectionSlice(source, SECTION_MARKERS.view, SECTION_MARKERS.modals);
  const modalsStart = source.indexOf(SECTION_MARKERS.modals);

  if (header === null || view === null || modalsStart === -1) {
    return { header: "", view: source, modals: "" };
  }

  return {
    header,
    view,
    modals: source.slice(modalsStart + SECTION_MARKERS.modals.length),
  };
}

export function ensureRenderMounts(root) {
  if (!root) return null;

  let header = root.querySelector("#header-mount");
  let view = root.querySelector("#view-mount");
  let modals = root.querySelector("#modal-mount");

  if (header && view && modals) {
    return { header, view, modals };
  }

  root.innerHTML =
    '<div id="header-mount"></div><div id="view-mount"></div><div id="modal-mount"></div>';

  header = root.querySelector("#header-mount");
  view = root.querySelector("#view-mount");
  modals = root.querySelector("#modal-mount");

  return { header, view, modals };
}

function updateMount(target, html) {
  const nextHtml = html || "";
  if (target && target.innerHTML !== nextHtml) {
    target.innerHTML = nextHtml;
  }
}

export function mountLegacySections(root, sections, scope = "all") {
  const mounts = ensureRenderMounts(root);
  if (!mounts) return null;

  if (scope === "all" || scope === "header") {
    updateMount(mounts.header, sections.header);
  }
  if (scope === "all" || scope === "view") {
    updateMount(mounts.view, sections.view);
  }
  if (scope === "all" || scope === "modals") {
    updateMount(mounts.modals, sections.modals);
  }

  return mounts;
}

export function mountLegacyHtml(root, html, scope = "all") {
  return mountLegacySections(root, splitLegacyHtml(html), scope);
}
