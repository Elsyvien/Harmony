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

  els.topbar.innerHTML = `
    <div>
      <p class="topbar__eyebrow">Documentation</p>
      <h1 class="topbar__title">Harmony Documentation</h1>
      <p class="topbar__summary">
        Canonical project documentation for architecture, runtime contracts, operations, and contributor workflows.
      </p>
    </div>
    <div class="topbar__meta">
      <div class="meta-pill-row">
        <span class="meta-pill">Docs <strong>${DOCS.length}</strong></span>
        <span class="meta-pill">Categories <strong>3</strong></span>
        <span class="meta-pill">Viewer <strong>Markdown + HTML</strong></span>
      </div>
      <div class="topbar__actions">
        <a class="primary-button" href="${createRoute("setup")}">Quick Start</a>
        <a class="ghost-button" href="${createRoute("architecture")}">Architecture</a>
      </div>
    </div>
  `;

  els.content.innerHTML = `
    <div class="hero-stage">
      <section class="hero-panel">
        <div class="hero-panel__eyebrow">Overview</div>
        <h2 class="hero-panel__title">Clean project documentation, in one place.</h2>
        <p class="hero-panel__summary">
          Harmony has detailed documentation for setup, architecture, API contracts, realtime behavior,
          voice transport, data modeling, and contributor workflows. This viewer keeps those markdown
          files as the source of truth while presenting them in a proper documentation layout.
        </p>
        <div class="hero-panel__actions">
          <a class="primary-button" href="${createRoute("setup")}">Get started</a>
          <a class="ghost-button" href="${createRoute("operations")}">Operations</a>
          <a class="ghost-button" href="${createRoute("file-map")}">Repo Map</a>
        </div>
      </section>

      <section class="stats-grid">
        <article class="stat-card">
          <span class="stat-card__value">${DOCS.length}</span>
          <div class="stat-card__label">Docs In Scope</div>
          <div class="stat-card__hint">Canonical markdown sources rendered inside the docs viewer.</div>
        </article>
        <article class="stat-card">
          <span class="stat-card__value">REST + WS</span>
          <div class="stat-card__label">Runtime Coverage</div>
          <div class="stat-card__hint">HTTP, WebSocket, voice transport, analytics, and operations.</div>
        </article>
        <article class="stat-card">
          <span class="stat-card__value">3</span>
          <div class="stat-card__label">Sections</div>
          <div class="stat-card__hint">Foundations, runtime references, and contributor guidance.</div>
        </article>
        <article class="stat-card">
          <span class="stat-card__value">${filteredDocs.length}</span>
          <div class="stat-card__label">${state.query ? "Search Hits" : "Visible Docs"}</div>
          <div class="stat-card__hint">${state.query ? `Filtered by "${escapeHtml(state.query)}".` : "Search and deep-linking are available across the docs set."}</div>
        </article>
      </section>

      <section class="section-shell">
        <div class="section-heading">
          <div>
            <h2>Key references</h2>
            <p>Start with the docs that define runtime behavior, transport flow, and integration boundaries.</p>
          </div>
        </div>
        <div class="feature-grid">
          ${featuredDocs.map((doc) => `
            <article class="feature-card">
              <span class="feature-card__label">${escapeHtml(doc.category)}</span>
              <h3>${escapeHtml(doc.title)}</h3>
              <p>${escapeHtml(doc.summary)}</p>
              <div class="hero-panel__actions">
                <a class="ghost-button" href="${createRoute(doc.id)}">Open</a>
              </div>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="section-shell">
        <div class="section-heading">
          <div>
            <h2>Quick start</h2>
            <p>Get a local stack running, then move into the runtime and troubleshooting references.</p>
          </div>
        </div>
        <div class="launch-grid">
          <article class="launch-card launch-card--code">
            <h3>Local Bootstrap</h3>
            <p>Shortest path from clone to a running frontend, backend, and seeded database.</p>
            <pre class="launch-card__pre"><code>npm install
npm --workspace backend exec prisma db push
npm --workspace backend run prisma:seed
npm run dev</code></pre>
          </article>
          <article class="launch-card">
            <h3>What to verify first</h3>
            <p>Use the operational docs as a checklist once the stack is up.</p>
            <ul class="check-list">
              <li><span><strong>Health:</strong> confirm <code>GET /health</code> returns <code>{ "ok": true }</code>.</span></li>
              <li><span><strong>Auth:</strong> register or login, then verify <code>/me</code>.</span></li>
              <li><span><strong>Realtime:</strong> join a channel and confirm message fanout.</span></li>
              <li><span><strong>Voice:</strong> inspect <code>/rtc/config</code> before debugging browser media.</span></li>
            </ul>
          </article>
        </div>
      </section>

      <section class="section-shell">
        <div class="section-heading">
          <div>
            <h2>Browse the docs</h2>
            <p>Each entry opens the canonical markdown source inside the docs viewer.</p>
          </div>
        </div>
        <div class="doc-card-grid">
          ${filteredDocs.map((doc) => renderDocCard(doc)).join("")}
        </div>
      </section>

      <section class="section-shell">
        <div class="section-heading">
          <div>
            <h2>Documentation notes</h2>
            <p>The markdown remains source-of-truth. This site is the reading layer.</p>
          </div>
        </div>
        <div class="footer-grid">
          <article class="footer-card">
            <h3>Canonical Source</h3>
            <p>The docs live in <code>docs/*.md</code>. The viewer fetches and renders them, then rewrites internal links so readers stay inside the site.</p>
          </article>
          <article class="footer-card">
            <h3>Quick Access</h3>
            <div class="footer-card__list">
              ${quickDocs.map((doc) => `<a href="${createRoute(doc.id)}"><span>${escapeHtml(doc.title)}</span><span>↗</span></a>`).join("")}
            </div>
          </article>
          <article class="footer-card">
            <h3>Compatibility</h3>
            <p>Older alias URLs redirect into this viewer so existing links do not drop users back into a fragmented docs experience.</p>
          </article>
        </div>
      </section>
    </div>
  `;

  renderHomeOutline();
}

function renderDocCard(doc) {
  return `
    <article class="doc-card">
      <div class="doc-card__top">
        <span class="doc-card__tag">${escapeHtml(doc.category)}</span>
        <span class="doc-card__source">${escapeHtml(doc.file)}</span>
      </div>
      <div>
        <h3>${escapeHtml(doc.title)}</h3>
        <p>${escapeHtml(doc.summary)}</p>
      </div>
      <div class="doc-card__bottom">
        <span class="doc-card__metrics">${(doc.tags ?? []).slice(0, 3).map(escapeHtml).join(" · ")}</span>
        <a class="doc-card__link" href="${createRoute(doc.id)}">Open <span>→</span></a>
      </div>
    </article>
  `;
}

function renderHomeOutline() {
  els.outline.innerHTML = `
    <div class="outline__block">
      <p class="outline__label">Overview</p>
      <h2 class="outline__title">Start with setup, then move into the references you need.</h2>
      <p class="outline__text">Use setup and operations to get running, then jump into architecture, API, or repo orientation docs.</p>
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

    els.content.innerHTML = `
      <section class="doc-shell">
        <div class="doc-metrics">
          <article class="metric-card">
            <h3>Category</h3>
            <p>${escapeHtml(doc.category)}</p>
          </article>
          <article class="metric-card">
            <h3>Source</h3>
            <p><code>${escapeHtml(doc.file)}</code></p>
          </article>
          <article class="metric-card">
            <h3>Read Time</h3>
            <p>${readingTime} min</p>
          </article>
          <article class="metric-card">
            <h3>Topics</h3>
            <p>${escapeHtml((doc.tags ?? []).slice(0, 3).join(", "))}</p>
          </article>
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
      <p class="topbar__eyebrow">${escapeHtml(doc.category)}</p>
      <h1 class="topbar__title">${escapeHtml(doc.title)}</h1>
      <p class="topbar__summary">${escapeHtml(doc.summary)}</p>
    </div>
    <div class="topbar__meta">
      <div class="meta-pill-row">
        <span class="meta-pill">Source <strong>${escapeHtml(doc.file)}</strong></span>
        <span class="meta-pill">Route <strong>${escapeHtml(doc.id)}</strong></span>
      </div>
      <div class="topbar__actions">
        <a class="ghost-button" href="#home">Overview</a>
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
