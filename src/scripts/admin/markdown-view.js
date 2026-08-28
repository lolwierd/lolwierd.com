import { EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  Decoration,
  keymap,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  placeholder
} from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle, syntaxTree, bracketMatching } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { LanguageDescription } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// The languages the posts actually fence: go and json. Loaded on demand, so
// they are separate chunks rather than weight the editor carries to open a
// post with no code in it. Adding another is one entry here.
const codeLanguages = [
  LanguageDescription.of({
    name: "go",
    alias: ["golang"],
    load: () => import("@codemirror/lang-go").then((m) => m.go())
  }),
  LanguageDescription.of({
    name: "json",
    load: () => import("@codemirror/lang-json").then((m) => m.json())
  })
];

// The editor is decorated in place rather than split into a preview pane.
//
// A two-pane editor asks you to read one thing and edit another, and the page
// this writing is for has one column of serif prose. So bold is bold where it is
// typed, and the `**` that made it bold is only on screen while the caret is on
// that line -- which is the Obsidian behaviour: the line you are editing shows
// its source, every other line shows the result.

const heading = (level, size) => ({
  [`.cm-line.cm-h${level}`]: {
    fontFamily: "var(--serif)",
    fontSize: size,
    lineHeight: "1.25",
    letterSpacing: "-0.026em",
    color: "var(--ink-strong)"
  }
});

const theme = EditorView.theme({
  "&": {
    color: "var(--ink)",
    backgroundColor: "transparent",
    fontFamily: "var(--serif)",
    // The post page's measurements, from the tokens writing.css also reads.
    fontSize: "var(--prose-size)"
  },
  ".cm-scroller": {
    fontFamily: "var(--serif)",
    lineHeight: "var(--prose-leading)",
    overflow: "visible"
  },
  ".cm-content": {
    padding: "0",
    caretColor: "var(--accent)",
    // The reading measure, so what I write is the width it will be read at.
    maxWidth: "var(--measure)"
  },
  ".cm-line": { padding: "0" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)"
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-placeholder": { color: "var(--ink-faint)", fontStyle: "italic" },
  ...heading(1, "clamp(1.7rem, 3vw, 2.1rem)"),
  ...heading(2, "var(--prose-h2)"),
  ...heading(3, "var(--prose-h3)"),
  ...heading(4, "1.05rem"),
  ...heading(5, "1rem"),
  ...heading(6, "1rem"),
  ".cm-line.cm-blockquote": {
    paddingLeft: "var(--prose-indent)",
    borderLeft: "1px solid var(--rule)",
    color: "var(--ink-dim)"
  },
  // One box around the whole fence, with the post page's padding, rule and
  // ground. CodeMirror lays out lines, not blocks, so the block is drawn as a
  // run of lines that share a background and close at either end.
  ".cm-line.cm-codeline": {
    paddingLeft: "1.15rem",
    paddingRight: "1.15rem",
    borderLeft: "1px solid var(--rule)",
    borderRight: "1px solid var(--rule)",
    background: "var(--page-deep)",
    fontFamily: "var(--mono)",
    fontSize: "0.82rem",
    color: "var(--ink-dim)"
  },
  // The fences stay -- they are the only place a block's language is written,
  // and hiding them would mean you could not change it. But they are the edge of
  // the box, not a line of the program, so they are set as small as the label
  // they amount to.
  ".cm-line.cm-code-first, .cm-line.cm-code-last": {
    fontSize: "10px",
    lineHeight: "1.6",
    color: "color-mix(in srgb, var(--ink-faint) 70%, transparent)"
  },
  ".cm-line.cm-code-first": {
    marginTop: "1.25rem",
    paddingTop: "0.7rem",
    borderTop: "1px solid var(--rule)"
  },
  ".cm-line.cm-code-last": {
    paddingBottom: "0.7rem",
    borderBottom: "1px solid var(--rule)"
  },

  // Inline code is a box; code inside a fence is already in one. Both carry the
  // same highlight tag, so the box is taken back off here.
  ".cm-line.cm-codeline .cm-md-code": {
    padding: "0",
    border: "0",
    background: "none",
    fontSize: "inherit"
  },

  // A table cannot become a real table in a source editor without replacing the
  // rows with widgets, and a widget is not editable text. What it can do is stop
  // being illegible: pipes only line up in a monospaced face, so the rows are
  // set in one and the header rule is drawn under the delimiter row.
  ".cm-line.cm-table": {
    fontFamily: "var(--mono)",
    fontSize: "0.82rem",
    color: "var(--ink-dim)"
  },

  // The rule the post page draws for `---`.
  ".cm-line.cm-hr": {
    position: "relative",
    marginTop: "2rem",
    borderTop: "1px solid var(--rule)",
    color: "var(--ink-faint)"
  },

  // The two things the post page draws that plain highlighting cannot: a link
  // printed with the halftone rule under it, and inline code in its box. Same
  // declarations as .post-body a and .post-body :not(pre) > code, so a link
  // being written looks like the link that gets read.
  ".cm-md-link": {
    color: "var(--accent)",
    textDecoration: "none",
    backgroundImage:
      "linear-gradient(var(--accent), var(--accent)), repeating-linear-gradient(to right, color-mix(in srgb, var(--accent) 70%, transparent) 0 1px, transparent 1px 3px)",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "0 1.12em, 0 1.12em",
    backgroundSize: "0% 1px, 100% 1px"
  },
  ".cm-md-code": {
    padding: "0.1em 0.3em",
    border: "1px solid var(--rule)",
    background: "var(--page-deep)",
    fontFamily: "var(--mono)",
    fontSize: "var(--prose-code)",
    color: "var(--ink)"
  }
});

const highlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700", color: "var(--ink-strong)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--ink-faint)" },
  // The words of a link, printed the way the post page prints them.
  { tag: tags.link, class: "cm-md-link" },
  // A link's target is scaffolding, not prose: small, mono, out of the way.
  { tag: tags.url, fontFamily: "var(--mono)", fontSize: "11px", color: "var(--ink-faint)" },
  { tag: tags.monospace, class: "cm-md-code" },
  { tag: tags.labelName, fontFamily: "var(--mono)", fontSize: "11px", color: "var(--ink-faint)" },
  { tag: tags.quote, color: "var(--ink-dim)" },
  { tag: tags.contentSeparator, color: "var(--ink-faint)", fontFamily: "var(--mono)" },
  { tag: tags.atom, color: "var(--accent)" },
  // Code inside a fence, in the colours Shiki gives it on the post page. The
  // values are lifted from the built html of a post -- vitesse-light and
  // vitesse-dark -- so a keyword is the same green in the editor as it is in
  // the thing that gets read. admin.css holds the light and dark pairs.
  { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword, tags.definitionKeyword], color: "var(--code-keyword)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--code-type)" },
  { tag: [tags.standard(tags.typeName), tags.bool, tags.null, tags.self], color: "var(--code-builtin)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--code-string)" },
  { tag: [tags.number, tags.integer, tags.float], color: "var(--code-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--code-function)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--code-property)" },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: "var(--code-variable)" },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket, tags.derefOperator], color: "var(--code-punct)" },

  // Every markdown marker: **, #, >, -, `. On the line the caret is on they are
  // visible so I can edit them, and faint so they read as marks rather than as
  // words. Off that line they are not drawn at all -- see liveSyntax below.
  {
    tag: tags.processingInstruction,
    color: "color-mix(in srgb, var(--ink-faint) 62%, transparent)",
    fontWeight: "400"
  }
]);

// Line-level decoration. The inline tags above cover the words inside a
// heading, but not the `##` in front of them, and a half-sized hash next to a
// full-sized heading looks like a mistake. Sizing the whole line fixes it and
// gives blockquotes and fenced code somewhere to hang their treatment.
const lineStyles = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view) {
      const marks = [];
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            const level = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
            const fenced = node.name === "FencedCode" || node.name === "CodeBlock";
            const cls = level
              ? `cm-h${level[1]}`
              : node.name === "Blockquote"
                ? "cm-blockquote"
                : fenced
                  ? "cm-codeline"
                  : node.name === "HorizontalRule"
                    ? "cm-hr"
                    : node.name === "Table"
                      ? "cm-table"
                      : "";
            if (!cls) return;
            const first = view.state.doc.lineAt(node.from).number;
            const last = view.state.doc.lineAt(Math.min(node.to, view.state.doc.length)).number;
            for (let n = first; n <= last; n += 1) {
              // A code block is one box, not a box per line, so the first and
              // last lines carry the top and bottom of it.
              const edge = fenced
                ? `${n === first ? " cm-code-first" : ""}${n === last ? " cm-code-last" : ""}`
                : "";
              marks.push(
                Decoration.line({ class: `${cls}${edge}` }).range(view.state.doc.line(n).from)
              );
            }
          }
        });
      }

      marks.sort((a, b) => a.from - b.from);
      return Decoration.set(marks, true);
    }
  },
  { decorations: (value) => value.decorations }
);

// --------------------------------------------------------------------------
// Live preview: the syntax on the caret's line, the result everywhere else.
//
// Everything is still one document of markdown -- nothing is parsed into a
// separate rendered view, and nothing can drift out of sync with the file. The
// markers are simply not painted on the lines I am not editing, which is what
// makes the page look like the page.

// The marks that stand for something the decoration already shows: ** for bold,
// ## for a heading size, > for the quote rule. Hiding them loses nothing.
const INLINE_MARKS = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "LinkMark",
  "SubscriptMark",
  "SuperscriptMark"
]);

// ListMark is deliberately absent: a `-` at the start of a line reads as the
// bullet it is about to become, and hiding it would leave the line starting
// nowhere.

const hidden = Decoration.replace({});

// Which lines the caret is on -- used for the marks that belong to a whole
// line, like a heading's ## or a quote's >.
function activeLines(state) {
  const lines = new Set();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) lines.add(n);
  }
  return lines;
}

function touchesSelection(state, from, to) {
  for (const range of state.selection.ranges) {
    if (range.to >= from && range.from <= to) return true;
  }
  return false;
}

const liveSyntax = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view);
    }
    update(update) {
      // Selection included: moving the caret onto a line is what brings that
      // line's syntax back, so the decorations have to be rebuilt for a plain
      // cursor move as well as for an edit.
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = this.build(update.view);
      }
    }
    build(view) {
      const { state } = view;
      const live = activeLines(state);
      const ranges = [];

      const push = (from, to) => {
        if (to <= from) return;
        // A replacing decoration may not span a line break.
        if (state.doc.lineAt(from).number !== state.doc.lineAt(to).number) return;
        ranges.push(hidden.range(from, to));
      };

      // A block mark belongs to its line: put the caret anywhere on a heading
      // and the ## comes back.
      const hideByLine = (from, to) => {
        if (live.has(state.doc.lineAt(from).number)) return;
        push(from, to);
      };

      // An inline mark belongs to the thing it marks, not to the line. These
      // posts have paragraphs written as one long source line, so revealing a
      // whole line would drop every link and every ** in six lines of prose
      // because the caret landed somewhere in the paragraph. The caret has to
      // be inside (or against the edge of) the link itself.
      const hideByNode = (node, from, to) => {
        const owner = node.node.parent;
        const scope = owner ? { from: owner.from, to: owner.to } : { from, to };
        if (touchesSelection(state, scope.from, scope.to)) return;
        push(from, to);
      };

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name === "HeaderMark") {
              // The mark takes the space after it with it, or the line sits one
              // character right of every other line.
              let end = node.to;
              if (state.doc.sliceString(end, end + 1) === " ") end += 1;
              hideByLine(node.from, end);
              return;
            }

            if (node.name === "QuoteMark") {
              hideByLine(node.from, node.to);
              return;
            }

            // The post page draws a horizontal rule. Here the line itself is
            // the rule (see .cm-hr), so the dashes that make it are hidden the
            // same way every other mark is.
            if (node.name === "HorizontalRule") {
              hideByLine(node.from, node.to);
              return;
            }

            if (INLINE_MARKS.has(node.name)) {
              hideByNode(node, node.from, node.to);
              return;
            }

            // Inline code loses its backticks; a fence keeps its ``` and its
            // language, which are the only place that information lives.
            if (node.name === "CodeMark" && node.to - node.from < 3) {
              hideByNode(node, node.from, node.to);
              return;
            }

            // A link shows its words. The target is one keystroke away: put the
            // caret in the link and it is there.
            if (node.name === "URL" && node.node.parent && /^(Link|Image)$/.test(node.node.parent.name)) {
              hideByNode(node, node.from, node.to);
            }
            if (node.name === "LinkTitle") hideByNode(node, node.from, node.to);
          }
        });
      }

      ranges.sort((a, b) => a.from - b.from || a.to - b.to);
      return Decoration.set(ranges, true);
    }
  },
  {
    decorations: (value) => value.decorations,
    // Without this the browser will happily put the caret inside a replaced
    // range and leave it looking like it is nowhere.
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations || Decoration.none)
  }
);

// Cmd+K. With a selection, the selected words become the link text and the
// cursor lands in the empty target, which is the order I actually write in:
// the sentence first, then go and find the URL.
export function wrapLink(view) {
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to);
  const looksLikeUrl = /^(https?:\/\/|mailto:|\/)\S*$/.test(text.trim());

  const inserted = looksLikeUrl ? `[](${text.trim()})` : `[${text}]()`;
  const cursor = looksLikeUrl ? range.from + 1 : range.from + text.length + 3;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: inserted },
    selection: { anchor: cursor },
    scrollIntoView: true
  });
  return true;
}

export function createEditor({ parent, doc, onChange, onSave, onEscape }) {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        highlightActiveLine(),
        bracketMatching(),
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages }),
        syntaxHighlighting(highlight),
        lineStyles,
        liveSyntax,
        theme,
        placeholder("write."),
        // Ahead of the default keymap so Cmd+K is a link and not delete-line.
        Prec.high(
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (onSave(), true) },
            { key: "Mod-k", preventDefault: true, run: wrapLink },
            { key: "Escape", run: () => (onEscape(), true) }
          ])
        ),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        })
      ]
    })
  });
}
