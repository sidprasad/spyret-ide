var CodeMirror = require('codemirror');
var specEditor = require('../src/web/js/spytial-spec-editor.js');

// The red-black tree example from the SPyTIAL paper: YAML at column 0 inside a
// triple-backtick string, with the closing fence indented to match the Pyret
// around it.
var PAPER = [
  'data RBNode:',
  '  | Black(value, left, right)',
  'sharing:',
  '  method _output(self):',
  '    x = DR.genlayout(self, ```',
  'constraints:',
  '  - orientation:',
  '      selector: "{x, y : Red+Black | x->y in left}"',
  'directives:',
  '  - atomColor:',
  '      selector: Red',
  '      value: red',
  '  ```)',
  '  end,',
  'end'
].join("\n");

function docAt(text, index) {
  var doc = new CodeMirror.Doc(text, "pyret");
  doc.setCursor(doc.posFromIndex(index));
  return doc;
}

function docSelecting(text, from, to) {
  var doc = new CodeMirror.Doc(text, "pyret");
  doc.setSelection(doc.posFromIndex(from), doc.posFromIndex(to));
  return doc;
}

// Apply `edited` over `raw`, given whether the replaced range already sits on
// its own line at each end. Same composition openForEditor uses.
function applyEdit(raw, edited, atStart, atEnd) {
  var split = specEditor.splitIndent(raw);
  return specEditor.buildReplacement(raw, edited, split.indent, atStart, atEnd);
}

// Pull the YAML out and put it straight back, unedited. A range that carries
// its own framing needs no help from the surrounding document, so the
// line-boundary flags are irrelevant here; pass false to prove it.
function roundTrip(raw) {
  return applyEdit(raw, specEditor.splitIndent(raw).body, false, false);
}

describe("spytial spec editor: finding the spec", function() {
  it("expands from a cursor inside the fences to the YAML interior", function() {
    var doc = docAt(PAPER, PAPER.indexOf("- orientation"));
    var range = specEditor.findSpecRange(doc);
    expect(range).not.toBeNull();
    var raw = doc.getRange(range.from, range.to);
    expect(raw.indexOf("```")).toEqual(-1);
    expect(raw.slice(0, 13)).toEqual("\nconstraints:");
    expect(raw.slice(-3)).toEqual("\n  ");
  });

  it("returns null when the cursor is not inside any fenced string", function() {
    expect(specEditor.findSpecRange(docAt(PAPER, PAPER.indexOf("data RBNode")))).toBeNull();
  });

  it("strips the fences from a selection that includes them", function() {
    var open = PAPER.indexOf("```");
    var close = PAPER.indexOf("```", open + 3) + 3;
    var doc = docSelecting(PAPER, open, close);
    var range = specEditor.findSpecRange(doc);
    expect(doc.getRange(range.from, range.to).indexOf("```")).toEqual(-1);
  });

  it("leaves a selection of just the YAML alone", function() {
    var from = PAPER.indexOf("constraints:");
    var to = PAPER.indexOf("value: red") + "value: red".length;
    var doc = docSelecting(PAPER, from, to);
    var range = specEditor.findSpecRange(doc);
    expect(doc.getRange(range.from, range.to)).toEqual(PAPER.slice(from, to));
  });
});

describe("spytial spec editor: indentation", function() {
  it("round-trips column-0 YAML byte for byte", function() {
    var doc = docAt(PAPER, PAPER.indexOf("- orientation"));
    var range = specEditor.findSpecRange(doc);
    var raw = doc.getRange(range.from, range.to);
    expect(specEditor.splitIndent(raw).indent).toEqual("");
    expect(roundTrip(raw)).toEqual(raw);
  });

  it("round-trips uniformly indented YAML byte for byte", function() {
    var raw = "\n    constraints:\n      - orientation:\n          directions:\n            - left\n    ";
    var split = specEditor.splitIndent(raw);
    expect(split.indent).toEqual("    ");
    expect(split.body).toEqual("constraints:\n  - orientation:\n      directions:\n        - left");
    expect(roundTrip(raw)).toEqual(raw);
  });

  it("round-trips tab-indented YAML byte for byte", function() {
    var raw = "\n\t\tconstraints: []\n\t\tdirectives: []\n\t";
    expect(specEditor.splitIndent(raw).indent).toEqual("\t\t");
    expect(roundTrip(raw)).toEqual(raw);
  });

  it("keeps comments through an unedited round-trip", function() {
    var raw = "\n  # keep me\n  constraints: []\n  ";
    expect(specEditor.splitIndent(raw).body.indexOf("# keep me")).not.toEqual(-1);
    expect(roundTrip(raw)).toEqual(raw);
  });

  it("does not indent blank lines", function() {
    var raw = "\n  constraints: []\n\n  directives: []\n  ";
    var split = specEditor.splitIndent(raw);
    expect(specEditor.reindent(split.body, split.indent).split("\n")).toContain("");
    expect(roundTrip(raw)).toEqual(raw);
  });

  it("opens the fences out when a one-line spec grows", function() {
    // ```constraints: []``` -- the fences sit on the same line, so the
    // newlines have to come from somewhere.
    expect(applyEdit("constraints: []", "constraints:\n  - cyclic: {}", false, false))
      .toEqual("\nconstraints:\n  - cyclic: {}\n");
  });

  it("leaves a one-line spec on one line when it stays short", function() {
    expect(applyEdit("constraints: []", "directives: []", false, false))
      .toEqual("directives: []");
  });

  it("does not double the newlines the document already has", function() {
    // Selecting just the YAML inside ```\nconstraints: []\n``` leaves the
    // newlines outside the range. Synthesizing more would open a blank line
    // against each fence.
    expect(applyEdit("constraints: []", "constraints:\n  - cyclic: {}", true, true))
      .toEqual("constraints:\n  - cyclic: {}");
  });

  it("synthesizes only the side the document is missing", function() {
    expect(applyEdit("constraints: []", "constraints:\n  - cyclic: {}", true, false))
      .toEqual("constraints:\n  - cyclic: {}\n");
    expect(applyEdit("constraints: []", "constraints:\n  - cyclic: {}", false, true))
      .toEqual("\nconstraints:\n  - cyclic: {}");
  });

  it("applies the block's indent to newly added lines", function() {
    expect(applyEdit("\n    constraints: []\n    ", "constraints:\n  - cyclic: {}", false, false))
      .toEqual("\n    constraints:\n      - cyclic: {}\n    ");
  });

  it("strips the framing the spec editor puts around its own output", function() {
    // SpecEditor serializes with surrounding newlines; left in, they land as
    // blank lines against the fences.
    expect(applyEdit("\n  constraints: []\n  ", "\nconstraints:\n  - cyclic: {}\n\n", false, false))
      .toEqual("\n  constraints:\n    - cyclic: {}\n  ");
  });

  it("round-trips byte for byte even when the payload arrives padded", function() {
    var raw = "\n  constraints: []\n  ";
    expect(applyEdit(raw, "\n  constraints: []\n\n", false, false)).toEqual(raw);
  });
});

describe("spytial spec editor: line-boundary detection", function() {
  var TEXT = "fun f():\n  DR.genlayout(x, ```\nconstraints: []\n  ```)\nend";

  function posOf(index) {
    return new CodeMirror.Doc(TEXT, "pyret").posFromIndex(index);
  }

  it("sees a selection of just the YAML as sitting on its own line", function() {
    var doc = new CodeMirror.Doc(TEXT, "pyret");
    var from = posOf(TEXT.indexOf("constraints: []"));
    var to = posOf(TEXT.indexOf("constraints: []") + "constraints: []".length);
    expect(specEditor.isAtLineStart(doc, from)).toBe(true);
    expect(specEditor.isAtLineEnd(doc, to)).toBe(true);
  });

  it("sees YAML butted against the fences as not on its own line", function() {
    var inline = "DR.genlayout(x, ```constraints: []```)";
    var doc = new CodeMirror.Doc(inline, "pyret");
    var from = doc.posFromIndex(inline.indexOf("constraints: []"));
    var to = doc.posFromIndex(inline.indexOf("constraints: []") + "constraints: []".length);
    expect(specEditor.isAtLineStart(doc, from)).toBe(false);
    expect(specEditor.isAtLineEnd(doc, to)).toBe(false);
  });

  it("treats leading indentation as still being at the line start", function() {
    var indented = "  ```\n    constraints: []\n  ```";
    var doc = new CodeMirror.Doc(indented, "pyret");
    var from = doc.posFromIndex(indented.indexOf("constraints: []"));
    expect(specEditor.isAtLineStart(doc, from)).toBe(true);
  });
});
