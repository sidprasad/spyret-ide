/**
 * Structured editing for SPyTIAL layout specs.
 *
 * A spec is YAML living inside a Pyret triple-backtick string, usually handed
 * to DR.genlayout from a value's _output method. This module lets you open
 * that YAML in spytial-core's spec editor (the "no-code builder") and write the
 * result back over the original text.
 *
 * spytial-core is loaded from CDN in editor.html, so everything here goes
 * through window globals rather than an import.
 */

var CONTAINER_ID = "spytial-spec-editor-mount";
var OVERLAY_ID = "spytial-spec-editor-modal";
var FENCE = "```";
// The "+" prefix lets CodeMirror coalesce the write-back into one undo step,
// the same trick as "+insertImage" in cpo-main.js.
var EDIT_ORIGIN = "+spytialSpecEdit";

function flash(message) {
  if (window.flashMessage) { window.flashMessage(message); }
  else { console.warn(message); }
}

/***** Locating the spec in the source *****/

// Pair the ``` fences positionally (1st with 2nd, 3rd with 4th, ...) and return
// the interior of whichever pair contains the cursor.
function fencedRangeAt(doc, cursorIndex) {
  var text = doc.getValue();
  var fences = [];
  var at = text.indexOf(FENCE);
  while (at !== -1) {
    fences.push(at);
    at = text.indexOf(FENCE, at + FENCE.length);
  }
  for (var i = 0; i + 1 < fences.length; i += 2) {
    var start = fences[i] + FENCE.length;
    var end = fences[i + 1];
    if (cursorIndex >= start && cursorIndex <= end) {
      return { from: doc.posFromIndex(start), to: doc.posFromIndex(end) };
    }
  }
  return null;
}

// A selection may or may not include the fences. Shrink past them if it does,
// so both paths hand back a range covering only the YAML.
function stripFences(doc, range) {
  var text = doc.getRange(range.from, range.to);
  if (text.length < 2 * FENCE.length) { return range; }
  if (text.slice(0, FENCE.length) !== FENCE) { return range; }
  if (text.slice(-FENCE.length) !== FENCE) { return range; }
  return {
    from: doc.posFromIndex(doc.indexFromPos(range.from) + FENCE.length),
    to: doc.posFromIndex(doc.indexFromPos(range.to) - FENCE.length)
  };
}

function findSpecRange(doc) {
  if (doc.somethingSelected()) {
    return stripFences(doc, { from: doc.getCursor("from"), to: doc.getCursor("to") });
  }
  return fencedRangeAt(doc, doc.indexFromPos(doc.getCursor()));
}

/***** Indentation *****/

// YAML is indentation-sensitive and the editor re-serializes at column 0, so
// pull off whatever indent the whole block shares and put it back afterwards.
function commonIndent(lines) {
  var common = null;
  lines.forEach(function(line) {
    if (line.trim() === "") { return; }
    var lead = /^[ \t]*/.exec(line)[0];
    if (common === null) { common = lead; return; }
    var k = 0;
    while (k < common.length && k < lead.length && common[k] === lead[k]) { k++; }
    common = common.slice(0, k);
  });
  return common === null ? "" : common;
}

function splitIndent(raw) {
  var lines = raw.split("\n");
  var indent = commonIndent(lines);
  var body = lines.map(function(line) {
    // The prefix test has to come first: with an empty common indent every
    // line matches and is returned untouched, which is what we want. Falling
    // through to the strip below would flatten the whole block.
    if (line.slice(0, indent.length) === indent) { return line.slice(indent.length); }
    return line.replace(/^[ \t]+/, "");
  }).join("\n").trim();
  return { indent: indent, body: body };
}

function reindent(body, indent) {
  if (!indent) { return body; }
  return body.split("\n").map(function(line) {
    return line.trim() === "" ? line : indent + line;
  }).join("\n");
}

// Does only whitespace separate this position from the start / end of its line?
function isAtLineStart(doc, pos) {
  return /^[ \t]*$/.test(doc.getRange({ line: pos.line, ch: 0 }, pos));
}

function isAtLineEnd(doc, pos) {
  var eol = { line: pos.line, ch: doc.getLine(pos.line).length };
  return /^[ \t]*$/.test(doc.getRange(pos, eol));
}

// Rebuild what sits between the two fences: the author's gap after the opening
// fence, the re-indented YAML, then the gap before the closing fence. Keeping
// both gaps leaves the fences exactly where they were.
//
// A range with no gap of its own -- a selection of just the YAML, newlines
// left outside it -- needs one synthesized when the edit grows to several
// lines. Only where the document doesn't already supply the break, though:
// atStart/atEnd say the range is already sitting on its own line, and adding
// a newline there would open a blank line against the fence.
function reframe(raw, indented, atStart, atEnd) {
  var multiline = indented.indexOf("\n") !== -1;
  var leadMatch = /^[ \t]*\r?\n/.exec(raw);
  var trailMatch = /\r?\n[ \t]*$/.exec(raw);
  var lead = leadMatch ? leadMatch[0] : ((multiline && !atStart) ? "\n" : "");
  var trail = trailMatch ? trailMatch[0] : ((multiline && !atEnd) ? "\n" : "");
  return lead + indented + trail;
}

// Turn the editor's YAML into the text that replaces the original range.
//
// The trim matters: the spec editor frames its own output with surrounding
// newlines, and framing belongs to reframe. Left in, they land as blank lines
// against the fences. splitIndent trims the same way on the way in, so an
// unedited round-trip comes back byte for byte.
function buildReplacement(raw, edited, indent, atStart, atEnd) {
  return reframe(raw, reindent(edited.trim(), indent), atStart, atEnd);
}

/***** The dialog *****/

// Reuses the .modal classes from editor.css so the dialog picks up the active
// theme. Deliberately not #promptModal: modal-prompt.js owns that element and
// only knows how to render its own fixed set of option styles.
function buildModal() {
  var overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "modal";
  overlay.style.display = "block";
  overlay.style.paddingTop = "5vh";

  var content = document.createElement("div");
  content.className = "modal-content";
  content.style.width = "90vw";
  content.style.maxWidth = "1100px";
  content.style.height = "85vh";
  content.style.display = "flex";
  content.style.flexDirection = "column";

  var header = document.createElement("div");
  header.className = "modal-header";
  var title = document.createElement("h3");
  title.textContent = "Edit diagram spec";
  header.appendChild(title);

  var body = document.createElement("div");
  body.className = "modal-body";
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.flex = "1 1 auto";
  body.style.minHeight = "0";

  var mount = document.createElement("div");
  mount.id = CONTAINER_ID;
  mount.style.flex = "1 1 auto";
  mount.style.minHeight = "0";
  mount.style.overflow = "auto";
  body.appendChild(mount);

  var footer = document.createElement("div");
  footer.className = "modal-footer";
  var apply = document.createElement("button");
  apply.className = "submit blueButton";
  apply.textContent = "Apply";
  var cancel = document.createElement("button");
  cancel.className = "close blueButton";
  cancel.textContent = "Cancel";
  footer.appendChild(apply);
  footer.appendChild(cancel);

  content.appendChild(header);
  content.appendChild(body);
  content.appendChild(footer);
  overlay.appendChild(content);
  return { overlay: overlay, apply: apply, cancel: cancel };
}

// Resolves with the edited YAML, or null if the user cancelled or the editor
// could not be opened.
function openBuilder(initialYaml) {
  return new Promise(function(resolve) {
    if (typeof window.mountCndLayoutInterface !== "function") {
      flash("The Spytial spec editor is unavailable. Check that the spytial-core bundles loaded.");
      resolve(null);
      return;
    }

    var ui = buildModal();
    var currentYaml = initialYaml;
    var settled = false;

    // Read the result from this event rather than getCurrentCNDSpecFromReact():
    // that global regenerates the YAML from spytial-core's deprecated
    // constraint/directive arrays whenever the builder view is showing, which
    // drops comments and anything else those arrays don't model. The event
    // carries the spec editor's own onChange value, which round-trips intact.
    function onSpecChanged(e) {
      if (typeof e.detail === "string") { currentYaml = e.detail; }
    }

    // Bubble phase, and only when nothing else claimed the key, so Escape
    // closes an open autocomplete or add-menu before it closes the dialog.
    function onKeyDown(e) {
      if (e.key !== "Escape" || e.defaultPrevented) { return; }
      finish(null);
    }

    function finish(value) {
      if (settled) { return; }
      settled = true;
      window.removeEventListener("cnd-spec-changed", onSpecChanged);
      document.removeEventListener("keydown", onKeyDown);
      if (typeof window.unmountCndLayoutInterface === "function") {
        window.unmountCndLayoutInterface(CONTAINER_ID);
      }
      if (ui.overlay.parentNode) { ui.overlay.parentNode.removeChild(ui.overlay); }
      resolve(value);
    }

    ui.apply.onclick = function() { finish(currentYaml); };
    ui.cancel.onclick = function() { finish(null); };

    window.addEventListener("cnd-spec-changed", onSpecChanged);
    document.addEventListener("keydown", onKeyDown);

    // React looks the container up by id, so it has to be in the document
    // before we mount.
    document.body.appendChild(ui.overlay);
    var mounted = window.mountCndLayoutInterface(CONTAINER_ID, {
      initialYamlValue: initialYaml,
      initialIsNoCodeView: true
    });
    if (!mounted) {
      flash("Could not open the Spytial spec editor.");
      finish(null);
    }
  });
}

/***** Entry point *****/

function openForEditor(cm) {
  var doc = cm.getDoc();
  var range = findSpecRange(doc);
  if (!range) {
    flash("Put the cursor inside a ``` spec string, or select the YAML you want to edit.");
    return;
  }

  var raw = doc.getRange(range.from, range.to);
  var split = splitIndent(raw);
  // Track the range while the dialog is up, so an edit landing in the meantime
  // can't send the write-back to the wrong place.
  var marker = doc.markText(range.from, range.to, { clearWhenEmpty: false });

  openBuilder(split.body).then(function(edited) {
    var live = marker.find();
    marker.clear();
    if (edited === null) { return; }
    if (edited.trim() === split.body) { return; }
    if (!live) {
      flash("That spec moved while you were editing it, so nothing was changed.");
      return;
    }
    var replacement = buildReplacement(
      raw,
      edited,
      split.indent,
      isAtLineStart(doc, live.from),
      isAtLineEnd(doc, live.to)
    );
    doc.replaceRange(replacement, live.from, live.to, EDIT_ORIGIN);
  });
}

module.exports = {
  openForEditor: openForEditor,
  // Exported for tests.
  findSpecRange: findSpecRange,
  splitIndent: splitIndent,
  reindent: reindent,
  reframe: reframe,
  buildReplacement: buildReplacement,
  isAtLineStart: isAtLineStart,
  isAtLineEnd: isAtLineEnd
};
