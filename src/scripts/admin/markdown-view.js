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
import { tags } from "@lezer/highlight";

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
    fontSize: "1.02rem"
  },
  ".cm-scroller": {
    fontFamily: "var(--serif)",
    lineHeight: "1.65",
    overflow: "visible"
  },
  ".cm-content": {
    padding: "0",
    caretColor: "var(--accent)",
    // The reading measure, so what I write is the width it will be read at.
    maxWidth: "33rem"
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
  ...heading(2, "clamp(1.35rem, 2vw, 1.65rem)"),
  ...heading(3, "1.15rem"),
  ...heading(4, "1.05rem"),
  ...heading(5, "1rem"),
  ...heading(6, "1rem"),
  ".cm-line.cm-blockquote": {
    paddingLeft: "0.9rem",
    borderLeft: "2px solid var(--rule)",
    color: "var(--ink-dim)",
    fontStyle: "italic"
  },
  ".cm-line.cm-codeline": {
    fontFamily: "var(--mono)",
    fontSize: "12px",
    color: "var(--ink-dim)"
  }
});

const highlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700", color: "var(--ink-strong)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--ink-faint)" },
  { tag: tags.link, color: "var(--ink)" },
  // A link's target is scaffolding, not prose: small, mono, out of the way.
  { tag: tags.url, fontFamily: "var(--mono)", fontSize: "11px", color: "var(--ink-faint)" },
  { tag: tags.monospace, fontFamily: "var(--mono)", fontSize: "0.88em", color: "var(--ink-dim)" },
  { tag: tags.labelName, fontFamily: "var(--mono)", fontSize: "11px", color: "var(--ink-faint)" },
  { tag: tags.quote, color: "var(--ink-dim)" },
  { tag: tags.contentSeparator, color: "var(--ink-faint)", fontFamily: "var(--mono)" },
  { tag: tags.atom, color: "var(--accent)" },
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
            const cls = level
              ? `cm-h${level[1]}`
              : node.name === "Blockquote"
                ? "cm-blockquote"
                : node.name === "FencedCode" || node.name === "CodeBlock"
                  ? "cm-codeline"
                  : "";
            if (!cls) return;
            const first = view.state.doc.lineAt(node.from).number;
            const last = view.state.doc.lineAt(Math.min(node.to, view.state.doc.length)).number;
            for (let n = first; n <= last; n += 1) {
              marks.push(Decoration.line({ class: cls }).range(view.state.doc.line(n).from));
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
const MARKS = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "HeaderMark",
  "QuoteMark",
  "LinkMark",
  "SubscriptMark",
  "SuperscriptMark"
]);

// ListMark is deliberately absent: a `-` at the start of a line reads as the
// bullet it is about to become, and hiding it would leave the line starting
// nowhere.

const hidden = Decoration.replace({});

function activeLines(state) {
  const lines = new Set();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) lines.add(n);
  }
  return lines;
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

      const hide = (from, to) => {
        if (to <= from) return;
        if (live.has(state.doc.lineAt(from).number)) return;
        if (state.doc.lineAt(from).number !== state.doc.lineAt(to).number) return;
        ranges.push(hidden.range(from, to));
      };

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from,
          to,
          enter: (node) => {
            if (MARKS.has(node.name)) {
              // A heading mark takes the space after it with it, or the line
              // would sit one character right of every other line.
              let end = node.to;
              if (node.name === "HeaderMark" && state.doc.sliceString(end, end + 1) === " ") end += 1;
              hide(node.from, end);
              return;
            }

            // Inline code loses its backticks; a fence keeps its ``` and its
            // language, which are the only place that information lives.
            if (node.name === "CodeMark" && node.to - node.from < 3) {
              hide(node.from, node.to);
              return;
            }

            // A link shows its words. The target is still one keystroke away --
            // put the caret on the line and it is there.
            if (node.name === "URL" && node.node.parent && /^(Link|Image)$/.test(node.node.parent.name)) {
              hide(node.from, node.to);
            }
            if (node.name === "LinkTitle") hide(node.from, node.to);
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
        markdown({ base: markdownLanguage }),
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
