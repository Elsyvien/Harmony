const navLinks = Array.from(document.querySelectorAll(".nav-link"));
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const sectionById = new Map(sections.map((section) => [section.id, section]));
const searchInput = document.querySelector("#doc-search");

if (searchInput) {
  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    for (const [id, section] of sectionById) {
      const text = section.textContent?.toLowerCase() ?? "";
      const visible = !query || text.includes(query) || id.includes(query);
      section.style.display = visible ? "" : "none";
    }
  });
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }
      const id = entry.target.getAttribute("id");
      for (const link of navLinks) {
        link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
      }
    }
  },
  { rootMargin: "-35% 0px -55% 0px", threshold: 0.01 },
);

for (const section of sections) {
  observer.observe(section);
}
