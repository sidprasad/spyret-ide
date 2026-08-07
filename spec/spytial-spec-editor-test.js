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

// Pull the YAML out and put it straight back, unedited.
function roundTrip(raw) {
  var split = specEditor.splitIndent(raw);
  return specEditor.reframe(raw, specEditor.reindent(split.body, split.indent));
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
    var raw = "constraints: []";
    var split = specEditor.splitIndent(raw);
    expect(specEditor.reframe(raw, specEditor.reindent("constraints:\n  - cyclic: {}", split.indent)))
      .toEqual("\nconstraints:\n  - cyclic: {}\n");
  });

  it("leaves a one-line spec on one line when it stays short", function() {
    var raw = "constraints: []";
    var split = specEditor.splitIndent(raw);
    expect(specEditor.reframe(raw, specEditor.reindent("directives: []", split.indent)))
      .toEqual("directives: []");
  });

  it("applies the block's indent to newly added lines", function() {
    var raw = "\n    constraints: []\n    ";
    var split = specEditor.splitIndent(raw);
    expect(specEditor.reframe(raw, specEditor.reindent("constraints:\n  - cyclic: {}", split.indent)))
      .toEqual("\n    constraints:\n      - cyclic: {}\n    ");
  });
});
