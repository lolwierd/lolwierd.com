// The one place that knows what a post file looks like on disk.
//
// Shared by three callers that must agree exactly: the browser editor (which
// validates before it lets me save), the dev-only disk endpoint, and the Pages
// Function that commits through GitHub. If they disagreed, the editor would
// happily commit something the build then rejects.
//
// The rules below mirror src/content.config.ts. Change one, change the other.

export const WRITING_DIR = "src/content/writing";

// Matches the ids the glob loader derives from filenames, so the slug I pick in
// the editor is the URL the post ends up at.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The keys this file understands. Anything else in a post's frontmatter is
// carried through untouched rather than silently dropped on save.
const KNOWN = new Set(["title", "summary", "date", "updated", "tags", "draft"]);

export function slugify(title) {
  return String(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

export function isValidSlug(slug) {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

export function postPath(slug) {
  return `${WRITING_DIR}/${slug}.md`;
}

// Not a YAML parser. It reads the shape this site actually writes -- scalars,
// inline and block sequences -- and hands anything stranger back as raw lines.
export function parseFrontmatter(text) {
  const source = String(text).replace(/^﻿/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, extra: [], body: source };

  const data = {};
  const extra = [];
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) {
      extra.push(line);
      continue;
    }

    const key = kv[1];
    let raw = kv[2];

    // A block sequence: the value is empty and the following indented lines
    // start with a dash.
    const items = [];
    if (!raw.trim()) {
      while (i + 1 < lines.length && /^\s+-\s*/.test(lines[i + 1])) {
        items.push(scalar(lines[i + 1].replace(/^\s+-\s*/, "")));
        i += 1;
      }
    }

    if (!KNOWN.has(key)) {
      extra.push(line);
      for (const item of items) extra.push(`  - ${item}`);
      continue;
    }

    if (items.length) data[key] = items;
    else if (raw.trim().startsWith("[")) data[key] = inlineList(raw);
    else data[key] = scalar(raw);
  }

  return { data, extra, body: source.slice(match[0].length) };
}

function scalar(raw) {
  const value = raw.trim().replace(/\s+#.*$/, "");
  if (/^"(.*)"$/s.test(value)) return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (/^'(.*)'$/s.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function inlineList(raw) {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner.split(",").map((part) => scalar(part)).filter(Boolean);
}

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Tags are written bare when they are plain words, which is how every post in
// the repo already looks, and quoted only when they would otherwise be ambiguous.
function tag(value) {
  return /^[a-z0-9][a-z0-9._+-]*$/i.test(value) ? value : quote(value);
}

export function serializePost(fields, body, extra = []) {
  const lines = [
    "---",
    `title: ${quote(fields.title)}`,
    `summary: ${quote(fields.summary)}`,
    `date: ${fields.date}`
  ];
  if (fields.updated) lines.push(`updated: ${fields.updated}`);
  if (fields.tags && fields.tags.length) lines.push(`tags: [${fields.tags.map(tag).join(", ")}]`);
  // Only written when true. A `draft: false` line on every published post is
  // noise in the diff, and the schema defaults it to false anyway.
  if (fields.draft) lines.push("draft: true");
  for (const line of extra) lines.push(line);
  lines.push("---", "");

  const text = String(body ?? "").replace(/^\n+/, "").replace(/\s*$/, "");
  return `${lines.join("\n")}\n${text}\n`;
}

// Puts back the file's own value for a date the form did not change, so a
// `2022-09-12T08:58:00` survives a save that was about the prose.
export function keepUnchangedDates(fields, existing) {
  if (!existing) return fields;
  const kept = { ...fields };
  if (existing.dateRaw && existing.date === fields.date) kept.date = existing.dateRaw;
  if (existing.updatedRaw && existing.updated === fields.updated) kept.updated = existing.updatedRaw;
  return kept;
}

// The same checks src/content.config.ts would apply at build time, run before a
// save instead of after a failed deploy.
export function validatePost(fields) {
  const errors = [];
  const str = (v) => typeof v === "string" && v.trim().length > 0;

  if (!str(fields.title)) errors.push("title is required");
  if (!str(fields.summary)) errors.push("summary is required");
  if (!str(fields.date) || !DATE_RE.test(fields.date) || Number.isNaN(Date.parse(fields.date))) {
    errors.push("date must be a real yyyy-mm-dd");
  }
  if (fields.updated) {
    if (!DATE_RE.test(fields.updated) || Number.isNaN(Date.parse(fields.updated))) {
      errors.push("updated must be a real yyyy-mm-dd");
    }
  }
  if (!Array.isArray(fields.tags) || fields.tags.some((t) => !str(t))) {
    errors.push("tags must be a list of words");
  }
  if (typeof fields.draft !== "boolean") errors.push("draft must be true or false");
  return errors;
}

// Everything the editor needs about one post, from its file text.
export function readPost(slug, text) {
  const { data, extra, body } = parseFrontmatter(text);
  return {
    slug,
    title: typeof data.title === "string" ? data.title : "",
    summary: typeof data.summary === "string" ? data.summary : "",
    date: normalizeDate(data.date),
    updated: data.updated ? normalizeDate(data.updated) : "",
    // What the file actually says. The form is date-only, so a post whose date
    // carries a time of day would lose it on every save that did not touch the
    // date -- keeping the raw value lets a save put back exactly what it read.
    dateRaw: data.date ? String(data.date).trim() : "",
    updatedRaw: data.updated ? String(data.updated).trim() : "",
    tags: Array.isArray(data.tags) ? data.tags : data.tags ? [String(data.tags)] : [],
    draft: data.draft === true || data.draft === "true",
    extra,
    body
  };
}

function normalizeDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (DATE_RE.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? text : parsed.toISOString().slice(0, 10);
}
