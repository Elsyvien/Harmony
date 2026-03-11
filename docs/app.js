const DOCS = [
  {
    id: "docs-hub",
    title: "Documentation Hub",
    file: "README.md",
    category: "Foundations",
    summary: "Reading order, update rules, source boundaries, and the canonical map of the docs set.",
    tags: ["overview", "navigation", "policy"],
  },
  {
    id: "setup",
    title: "Setup",
    file: "SETUP.md",
    category: "Foundations",
    summary: "Shortest reliable path from clone to local stack, including Windows and bash env bootstrap.",
    tags: ["install", "quickstart", "local"],
  },
  {
    id: "operations",
    title: "Operations",
    file: "OPERATIONS.md",
    category: "Foundations",
    summary: "Environment profiles, runbooks, deployment notes, smoke tests, and troubleshooting.",
    tags: ["deploy", "runbook", "voice", "turn", "sfu"],
  },
  {
    id: "architecture",
    title: "Architecture",
    file: "ARCHITECTURE.md",
    category: "Runtime",
    summary: "End-to-end system topology, startup lifecycle, realtime behavior, voice flow, and telemetry path.",
    tags: ["backend", "frontend", "ws", "voice", "transport"],
  },
  {
    id: "backend-reference",
    title: "Backend Reference",
    file: "BACKEND_REFERENCE.md",
    category: "Runtime",
    summary: "Fastify routes, service rules, repository responsibilities, WebSocket protocol, and env contracts.",
    tags: ["api", "fastify", "services", "repositories"],
  },
  {
    id: "frontend-reference",
    title: "Frontend Reference",
    file: "FRONTEND_REFERENCE.md",
    category: "Runtime",
    summary: "React orchestration, session state, transport hooks, chat flows, and UI contracts.",
    tags: ["react", "state", "socket", "components"],
  },
  {
    id: "data-model",
    title: "Data Model",
    file: "DATA_MODEL.md",
    category: "Runtime",
    summary: "Prisma schema semantics, relationships, invariants, and persistence-level constraints.",
    tags: ["prisma", "schema", "database"],
  },
  {
    id: "api",
    title: "API Quick Reference",
    file: "API.md",
    category: "Runtime",
    summary: "Condensed endpoint, payload, error, and WebSocket event reference with working examples.",
    tags: ["rest", "ws", "contracts", "errors"],
  },
  {
    id: "integration-examples",
    title: "Integration Examples",
    file: "INTEGRATION_EXAMPLES.md",
    category: "Runtime",
    summary: "Copy-paste flows for auth, uploads, messages, invites, voice join, SFU requests, and analytics.",
    tags: ["examples", "curl", "fetch", "voice"],
  },
  {
    id: "analytics",
    title: "Analytics",
    file: "ANALYTICS.md",
    category: "Runtime",
    summary: "Client and server telemetry taxonomy, ingestion rules, retention, and admin analytics surfaces.",
    tags: ["telemetry", "events", "retention"],
  },
  {
    id: "ai-agent-guide",
    title: "AI Agent Guide",
    file: "AI_AGENT_GUIDE.md",
    category: "Contributor",
    summary: "High-risk invariants, safe edit playbooks, testing expectations, and repo-specific pitfalls.",
    tags: ["ai", "contributor", "invariants"],
    aliases: ["ai-agent-guide.html"],
  },
  {
    id: "documentation-guide",
    title: "Documentation Guide",
    file: "DOCUMENTATION_GUIDE.md",
    category: "Contributor",
    summary: "How to maintain canonical docs, update the docs UI, and keep markdown and site behavior aligned.",
    tags: ["maintenance", "docs", "workflow"],
  },
  {
    id: "file-map",
    title: "File Map",
    file: "FILE_MAP.md",
    category: "Contributor",
    summary: "Tracked-file ownership map across backend, frontend, docs, tests, and tooling.",
    tags: ["files", "ownership", "orientation"],
    aliases: ["file-map.html"],
  },
  {
    id: "structure",
    title: "Project Structure",
    file: "structure.md",
    category: "Contributor",
    summary: "Compact module-level structure map for faster orientation in the repo.",
    tags: ["structure", "orientation"],
  },
  {
    id: "roadmap",
    title: "Roadmap",
    file: "ROADMAP.md",
    category: "Contributor",
    summary: "Current engineering and product direction, separate from runtime truth.",
    tags: ["planning", "future"],
  },
];

const DOCS_BY_ID = new Map(DOCS.map((doc) => [doc.id, doc]));
const DOCS_BY_FILE = new Map();
for (const doc of DOCS) {
  DOCS_BY_FILE.set(normalizeFileKey(doc.file), doc);
  for (const alias of doc.aliases ?? []) {
    DOCS_BY_FILE.set(normalizeFileKey(alias), doc);
  }
}

const state = {
  query: "",
  currentDocId: null,
  currentAnchor: "",
  currentHeadings: [],
  docsCache: new Map(),
};

const els = {
  navPanel: document.querySelector("#nav-panel"),
  nav: document.querySelector("#doc-nav"),
  search: document.querySelector("#doc-search"),
  content: document.querySelector("#content"),
  topbar: document.querySelector("#topbar"),
  outline: document.querySelector("#outline"),
  navToggle: document.querySelector("#nav-toggle"),
  outlineToggle: document.querySelector("#outline-toggle"),
};

const FEATURED_DOC_IDS = ["architecture", "backend-reference", "frontend-reference", "integration-examples"];
const QUICK_LINK_DOC_IDS = ["setup", "operations", "api", "file-map"];

document.addEventListener("click", onDocumentClick);
window.addEventListener("hashchange", renderRoute);
window.addEventListener("scroll", syncActiveOutline, { passive: true });
window.addEventListener("resize", closePanelsOnDesktop);

if (els.search) {
  els.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    renderNav();
    if (!state.currentDocId) {
      renderHome();
    }
  });
}

if (els.navToggle) {
  els.navToggle.addEventListener("click", () => {
    document.body.classList.toggle("nav-open");
  });
}

if (els.outlineToggle) {
  els.outlineToggle.addEventListener("click", () => {
    document.body.classList.toggle("outline-open");
  });
}

if (window.marked?.setOptions) {
  window.marked.setOptions({
    gfm: true,
    breaks: false,
    headerIds: false,
    mangle: false,
  });
}

renderRoute();

function normalizeFileKey(value) {
  return String(value)
    .replace(/^\.?\//, "")
    .replace(/^docs\//, "")
    .trim()
    .toLowerCase();
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=\[\]{}|\\:;"'<>,.?/]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function estimateReadingTime(markdown) {
  const plain = markdown.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]+`/g, " ");
  const words = plain.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function getAllDocs() {
  return DOCS.slice();
}

function getFilteredDocs() {
  if (!state.query) {
    return getAllDocs();
  }

  return DOCS.filter((doc) => {
    const haystack = [doc.title, doc.summary, doc.category, ...(doc.tags ?? [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.query);
  });
}

function groupDocs(docs) {
  return docs.reduce((groups, doc) => {
    const key = doc.category;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(doc);
    return groups;
  }, new Map());
}

function createRoute(docId, anchor = "") {
  return `#doc/${docId}${anchor ? `/section/${encodeURIComponent(anchor)}` : ""}`;
}

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (!raw || raw === "home") {
    return { type: "home", anchor: "" };
  }

  const match = raw.match(/^doc\/([^/]+)(?:\/section\/(.+))?$/);
  if (!match) {
    return { type: "home", anchor: "" };
  }

  const [, id, anchor = ""] = match;
  if (!DOCS_BY_ID.has(id)) {
    return { type: "home", anchor: "" };
  }

  return { type: "doc", id, anchor: decodeURIComponent(anchor) };
}

function setPageTitle(doc) {
  document.title = doc ? `${doc.title} · Harmony Docs` : "Harmony Docs";
}

function renderNav() {
  const docs = getFilteredDocs();
  const groups = groupDocs(docs);
  const html = [];

  html.push(`
    <section class="doc-nav__group">
      <p class="doc-nav__label">Home</p>
      <div class="doc-nav__list">
        ${renderDocLink({
          id: "home",
          title: "Technical Atlas",
          category: "Overview",
          summary: "Browse architecture, runtime contracts, operations, and contributor guides.",
          route: "#home",
          active: !state.currentDocId,
          tag: "Site",
        })}
      </div>
    </section>
  `);

  for (const [label, items] of groups) {
    html.push(`
      <section class="doc-nav__group">
        <p class="doc-nav__label">${label}</p>
        <div class="doc-nav__list">
          ${items.map((doc) =>
            renderDocLink({
              id: doc.id,
              title: doc.title,
              category: doc.category,
              summary: doc.summary,
              route: createRoute(doc.id),
              active: state.currentDocId === doc.id,
              tag: doc.category,
            }),
          ).join("")}
        </div>
      </section>
    `);
  }

  if (docs.length === 0) {
    html.push(`
      <section class="doc-nav__group">
        <div class="empty-state">
          <h3>No docs matched</h3>
          <p>Try a broader term such as <code>voice</code>, <code>api</code>, or <code>schema</code>.</p>
        </div>
      </section>
    `);
  }

  els.nav.innerHTML = html.join("");
}

function renderDocLink({ title, summary, route, active, tag }) {
  return `
    <a class="doc-link${active ? " is-active" : ""}" href="${route}">
      <div class="doc-link__meta">
        <span class="doc-link__tag">${escapeHtml(tag)}</span>
      </div>
      <div class="doc-link__title">${escapeHtml(title)}</div>
      <div class="doc-link__summary">${escapeHtml(summary)}</div>
    </a>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHome() {
  state.currentDocId = null;
  state.currentAnchor = "";
  state.currentHeadings = [];
  setPageTitle(null);

  const filteredDocs = getFilteredDocs();
  const featuredDocs = FEATURED_DOC_IDS.map((id) => DOCS_BY_ID.get(id)).filter(Boolean);
  const quickDocs = QUICK_LINK_DOC_IDS.map((id) => DOCS_BY_ID.get(id)).filter(Boolean);
  const groupedDocs = Array.from(groupDocs(filteredDocs).entries());

  els.topbar.innerHTML = `
    <div>
      <p class="topbar__eyebrow">Documentation</p>
      <h1 class="topbar__title">Harmony Docs</h1>
      <p class="topbar__summary">
        Technical documentation for the Harmony stack: setup, architecture, runtime contracts, operations, and contributor guides.
      </p>
    </div>
    <div class="topbar__meta">
      <div class="meta-pill-row">
        <span class="meta-pill">Docs <strong>${DOCS.length}</strong></span>
        <span class="meta-pill">Sections <strong>3</strong></span>
      </div>
      <div class="topbar__actions">
        <a class="primary-button" href="${createRoute("setup")}">Get Started</a>
        <a class="ghost-button" href="${createRoute("architecture")}">System Overview</a>
      </div>
    </div>
  `;

  els.content.innerHTML = `
    <div class="home-shell">
      <section class="home-intro">
        <p class="home-intro__eyebrow">Start here</p>
        <h2 class="home-intro__title">Read the system from setup to runtime.</h2>
        <p class="home-intro__summary">
          The markdown files in <code>docs/</code> remain the source of truth. This site is the reading layer:
          searchable, linkable, and structured for long technical pages instead of raw repository browsing.
        </p>
        <div class="home-intro__actions">
          <a class="primary-button" href="${createRoute("setup")}">Open setup guide</a>
          <a class="ghost-button" href="${createRoute("operations")}">Open operations</a>
          <a class="ghost-button" href="${createRoute("api")}">Open API reference</a>
        </div>
        <pre class="home-intro__snippet"><code>npm install
npm --workspace backend exec prisma db push
npm --workspace backend run prisma:seed
npm run dev</code></pre>
      </section>

      <section class="home-section">
        <div class="section-heading">
          <div>
            <h2>Recommended reading path</h2>
            <p>Follow this order if you are new to the codebase or bringing a local environment up from scratch.</p>
          </div>
        </div>
        <div class="reading-list">
          ${quickDocs.map((doc, index) => `
            <article class="reading-card">
              <div class="reading-card__step">0${index + 1}</div>
              <div class="reading-card__body">
                <div class="reading-card__meta">
                  <span>${escapeHtml(doc.category)}</span>
                  <span>${escapeHtml(doc.file)}</span>
                </div>
                <h3>${escapeHtml(doc.title)}</h3>
                <p>${escapeHtml(doc.summary)}</p>
              </div>
              <a class="reading-card__link" href="${createRoute(doc.id)}">Open</a>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="home-section">
        <div class="section-heading">
          <div>
            <h2>High-signal references</h2>
            <p>These pages define the runtime behavior, transport flow, and integration boundaries of the system.</p>
          </div>
        </div>
        <div class="reference-grid">
          ${featuredDocs.map((doc) => `
            <article class="reference-card">
              <div class="reference-card__meta">
                <span>${escapeHtml(doc.category)}</span>
                <span>${escapeHtml(doc.file)}</span>
              </div>
              <h3>${escapeHtml(doc.title)}</h3>
              <p>${escapeHtml(doc.summary)}</p>
              <a class="reference-card__link" href="${createRoute(doc.id)}">Read document</a>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="home-section">
        <div class="section-heading">
          <div>
            <h2>${state.query ? `Search results for "${escapeHtml(state.query)}"` : "Browse all documents"}</h2>
            <p>${state.query ? `${filteredDocs.length} documents matched the current filter.` : "Browse the full set by category. Each link opens the canonical markdown file in the reader."}</p>
          </div>
        </div>
        <div class="doc-groups">
          ${groupedDocs.length ? groupedDocs.map(([category, docs]) => `
            <section class="doc-group">
              <div class="doc-group__header">
                <h3>${escapeHtml(category)}</h3>
                <span>${docs.length} docs</span>
              </div>
              <div class="doc-group__items">
                ${docs.map((doc) => `
                  <a class="doc-list-item" href="${createRoute(doc.id)}">
                    <div class="doc-list-item__body">
                      <div class="doc-list-item__title-row">
                        <strong>${escapeHtml(doc.title)}</strong>
                        <code>${escapeHtml(doc.file)}</code>
                      </div>
                      <p>${escapeHtml(doc.summary)}</p>
                    </div>
                    <span class="doc-list-item__arrow">→</span>
                  </a>
                `).join("")}
              </div>
            </section>
          `).join("") : `
            <div class="empty-state">
              <h3>No docs matched</h3>
              <p>Try a broader term such as <code>voice</code>, <code>api</code>, or <code>schema</code>.</p>
            </div>
          `}
        </div>
      </section>
    </div>
  `;

  renderHomeOutline();
}

function renderHomeOutline() {
  els.outline.innerHTML = `
    <div class="outline__block">
      <p class="outline__label">Overview</p>
      <h2 class="outline__title">Start with setup, then work inward.</h2>
      <p class="outline__text">Use setup and operations first, then move into architecture, API, and module-level references.</p>
    </div>
    <div class="outline__block">
      <p class="outline__label">Recommended</p>
      <div class="outline__quick-list">
        <a href="${createRoute("setup")}"><span>Setup</span><span>→</span></a>
        <a href="${createRoute("operations")}"><span>Operations</span><span>→</span></a>
        <a href="${createRoute("architecture")}"><span>Architecture</span><span>→</span></a>
      </div>
    </div>
    <div class="outline__block">
      <p class="outline__label">Runtime Docs</p>
      <div class="outline__quick-list">
        <a href="${createRoute("backend-reference")}"><span>Backend Reference</span><span>→</span></a>
        <a href="${createRoute("frontend-reference")}"><span>Frontend Reference</span><span>→</span></a>
        <a href="${createRoute("api")}"><span>API Quick Reference</span><span>→</span></a>
      </div>
    </div>
  `;
}

async function renderDoc(doc, anchor) {
  state.currentDocId = doc.id;
  state.currentAnchor = anchor ? slugify(anchor) : "";
  setPageTitle(doc);
  renderDocTopbar(doc);
  els.content.innerHTML = `<div class="doc-loading">Loading ${escapeHtml(doc.title)}…</div>`;

  try {
    const markdown = await loadDocMarkdown(doc);
    const readingTime = estimateReadingTime(markdown);
    const html = renderMarkdown(markdown);
    const topics = (doc.tags ?? []).slice(0, 3).join(", ") || "General";

    els.content.innerHTML = `
      <section class="doc-shell">
        <div class="doc-meta">
          <div class="doc-meta__item">
            <span>Category</span>
            <strong>${escapeHtml(doc.category)}</strong>
          </div>
          <div class="doc-meta__item">
            <span>Source</span>
            <strong><code>${escapeHtml(doc.file)}</code></strong>
          </div>
          <div class="doc-meta__item">
            <span>Read time</span>
            <strong>${readingTime} min</strong>
          </div>
          <div class="doc-meta__item">
            <span>Topics</span>
            <strong>${escapeHtml(topics)}</strong>
          </div>
        </div>

        <article class="doc-shell__article">
          <div class="doc-markdown" id="doc-markdown">${html}</div>
        </article>

        <nav class="doc-pagination" aria-label="Adjacent documents">
          ${renderDocPagination(doc)}
        </nav>
      </section>
    `;

    const article = document.querySelector("#doc-markdown");
    state.currentHeadings = decorateDocContent(article, doc);
    renderDocOutline(doc);

    if (state.currentAnchor) {
      scrollToHeading(state.currentAnchor);
    } else {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    syncActiveOutline();
  } catch (error) {
    els.content.innerHTML = `
      <div class="doc-error">
        <h3>Could not load ${escapeHtml(doc.title)}</h3>
        <p>${escapeHtml(error instanceof Error ? error.message : "Unknown error")}</p>
      </div>
    `;
    els.outline.innerHTML = `
      <div class="outline__block">
        <p class="outline__label">Load Error</p>
        <h2 class="outline__title">The doc did not render.</h2>
        <p class="outline__text">Check that the markdown file exists and that the docs site can fetch it relative to this page.</p>
      </div>
    `;
  }
}

function renderDocTopbar(doc) {
  const sourceLink = `./${doc.file}`;
  els.topbar.innerHTML = `
    <div>
      <p class="topbar__eyebrow">${escapeHtml(doc.category)} documentation</p>
      <h1 class="topbar__title">${escapeHtml(doc.title)}</h1>
      <p class="topbar__summary">${escapeHtml(doc.summary)}</p>
    </div>
    <div class="topbar__meta">
      <div class="meta-pill-row">
        <span class="meta-pill">Source <strong>${escapeHtml(doc.file)}</strong></span>
        <span class="meta-pill">Route <strong>${escapeHtml(doc.id)}</strong></span>
      </div>
      <div class="topbar__actions">
        <a class="ghost-button" href="#home">All docs</a>
        <a class="primary-button" href="${sourceLink}" target="_blank" rel="noreferrer">Raw Markdown</a>
      </div>
    </div>
  `;
}

function renderDocPagination(doc) {
  const docs = getAllDocs();
  const currentIndex = docs.findIndex((item) => item.id === doc.id);
  const prev = currentIndex > 0 ? docs[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < docs.length - 1 ? docs[currentIndex + 1] : null;

  return [prev, next]
    .map((item, index) => {
      if (!item) {
        return `<div class="doc-empty">${index === 0 ? "Start of the docs set." : "End of the docs set."}</div>`;
      }

      return `
        <a class="doc-pagination__link" href="${createRoute(item.id)}">
          <span class="doc-pagination__label">${index === 0 ? "Previous" : "Next"}</span>
          <span class="doc-pagination__title">${escapeHtml(item.title)}</span>
        </a>
      `;
    })
    .join("");
}

function renderDocOutline(doc) {
  const sections = state.currentHeadings.filter((heading) => heading.level === 2 || heading.level === 3);
  els.outline.innerHTML = `
    <div class="outline__block">
      <p class="outline__label">Current Doc</p>
      <h2 class="outline__title">${escapeHtml(doc.title)}</h2>
      <p class="outline__text">${escapeHtml(doc.summary)}</p>
    </div>
    <div class="outline__block">
      <p class="outline__label">On This Page</p>
      ${
        sections.length
          ? `<div class="outline__list">
              ${sections.map((heading) => `
                <a class="outline__link outline__link--depth-${heading.level}" data-anchor-link="true" href="${createRoute(doc.id, heading.id)}">
                  ${escapeHtml(heading.text)}
                </a>
              `).join("")}
            </div>`
          : `<p class="outline__text">No section headings were detected in this document.</p>`
      }
    </div>
    <div class="outline__block">
      <p class="outline__label">Jump Elsewhere</p>
      <div class="outline__quick-list">
        <a href="${createRoute("api")}"><span>API Quick Reference</span><span>→</span></a>
        <a href="${createRoute("operations")}"><span>Operations</span><span>→</span></a>
        <a href="${createRoute("file-map")}"><span>File Map</span><span>→</span></a>
      </div>
    </div>
  `;
}

function renderMarkdown(markdown) {
  if (window.marked?.parse) {
    return window.marked.parse(markdown);
  }

  return `<pre>${escapeHtml(markdown)}</pre>`;
}

async function loadDocMarkdown(doc) {
  if (state.docsCache.has(doc.id)) {
    return state.docsCache.get(doc.id);
  }

  const response = await fetch(`./${doc.file}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${doc.file}`);
  }
  const markdown = await response.text();
  state.docsCache.set(doc.id, markdown);
  return markdown;
}

function decorateDocContent(container, currentDoc) {
  if (!container) {
    return [];
  }

  const headings = [];
  const seenIds = new Map();

  container.querySelectorAll("h1, h2, h3, h4").forEach((heading) => {
    const text = heading.textContent?.trim() ?? "";
    const baseId = slugify(text);
    const count = seenIds.get(baseId) ?? 0;
    const id = count === 0 ? baseId : `${baseId}-${count + 1}`;
    seenIds.set(baseId, count + 1);
    heading.id = id;

    if (heading.tagName !== "H1") {
      const anchor = document.createElement("a");
      anchor.className = "heading-anchor";
      anchor.href = createRoute(currentDoc.id, id);
      anchor.setAttribute("aria-label", `Link to section ${text}`);
      anchor.textContent = "#";
      heading.prepend(anchor);
    }

    headings.push({
      id,
      text,
      level: Number(heading.tagName.slice(1)),
    });
  });

  container.querySelectorAll("a[href]").forEach((link) => rewriteDocLink(link, currentDoc));

  if (window.hljs?.highlightElement) {
    container.querySelectorAll("pre code").forEach((block) => {
      window.hljs.highlightElement(block);
    });
  }

  return headings;
}

function rewriteDocLink(link, currentDoc) {
  const href = link.getAttribute("href");
  if (!href) {
    return;
  }

  if (href.startsWith("http://") || href.startsWith("https://")) {
    link.target = "_blank";
    link.rel = "noreferrer";
    return;
  }

  if (href.startsWith("mailto:")) {
    return;
  }

  if (href.startsWith("#")) {
    const anchor = slugify(href.slice(1));
    link.setAttribute("href", createRoute(currentDoc.id, anchor));
    link.dataset.anchorLink = "true";
    return;
  }

  const [pathPart, rawAnchor = ""] = href.split("#");
  const normalizedPath = normalizeFileKey(pathPart);
  const targetDoc =
    DOCS_BY_FILE.get(normalizedPath) ||
    DOCS_BY_FILE.get(normalizeFileKey(pathPart.replace(/\.html$/i, ".md"))) ||
    DOCS_BY_FILE.get(normalizeFileKey(pathPart.replace(/\.md$/i, ".html")));

  if (!targetDoc && (normalizedPath === "index.html" || normalizedPath === "")) {
    link.setAttribute("href", "#home");
    return;
  }

  if (!targetDoc) {
    return;
  }

  const anchor = rawAnchor ? slugify(rawAnchor) : "";
  link.setAttribute("href", createRoute(targetDoc.id, anchor));
}

function scrollToHeading(anchor) {
  const target = document.getElementById(anchor);
  if (!target) {
    return;
  }

  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncActiveOutline() {
  if (!state.currentDocId || !state.currentHeadings.length) {
    return;
  }

  const candidates = state.currentHeadings
    .map((heading) => ({
      heading,
      element: document.getElementById(heading.id),
    }))
    .filter((entry) => entry.element);

  if (!candidates.length) {
    return;
  }

  let current = candidates[0].heading.id;
  for (const entry of candidates) {
    const rect = entry.element.getBoundingClientRect();
    if (rect.top <= 150) {
      current = entry.heading.id;
    } else {
      break;
    }
  }

  document.querySelectorAll(".outline__link[data-anchor-link='true']").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    link.classList.toggle("is-active", href.endsWith(`/section/${encodeURIComponent(current)}`));
  });
}

function onDocumentClick(event) {
  const link = event.target.closest("a[href]");
  if (link) {
    if (link.closest("#nav-panel") || link.closest("#outline-panel")) {
      document.body.classList.remove("nav-open");
      if (link.closest("#outline-panel")) {
        document.body.classList.remove("outline-open");
      }
    }
  }

  if (event.target === els.navPanel || event.target === els.outline) {
    return;
  }
}

function closePanelsOnDesktop() {
  if (window.innerWidth > 1080) {
    document.body.classList.remove("nav-open");
  }
  if (window.innerWidth > 1300) {
    document.body.classList.remove("outline-open");
  }
}

function renderRoute() {
  renderNav();
  closePanelsOnDesktop();

  const route = parseRoute();
  if (route.type === "home") {
    renderHome();
    return;
  }

  const doc = DOCS_BY_ID.get(route.id);
  if (!doc) {
    renderHome();
    return;
  }

  void renderDoc(doc, route.anchor);
}
