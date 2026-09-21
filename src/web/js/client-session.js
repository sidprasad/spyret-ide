/* The static editor's Drive session and local recovery. No credentials are persisted. */
module.exports = function(options) {
  var query = new URLSearchParams(location.hash.slice(1));
  var file = null, dirty = false, attached = false, saving = null, connecting = false;
  var name = 'Untitled', persisted = true;
  var programId = query.get('program'), shareId = query.get('share');
  var resourceKey = query.get('resourcekey');
  var namespace = 'spyret-draft:' + window.APP_BASE_URL + ':';
  if (!programId && !shareId && !query.has('draft')) {
    query.set('draft', window.crypto.randomUUID());
    history.replaceState(null, '', '#' + query.toString());
  }
  var key = namespace + (programId ? 'program:' + programId : shareId ? 'share:' + shareId : 'draft:' + query.get('draft'));
  var restored;
  try { restored = JSON.parse(localStorage.getItem(key)); } catch (_) {}

  var status = $('<span id="save-status" role="status">').css({padding: '0 1em', 'font-size': '12px',
    display: 'block', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap'});
  $('#welcome .username-message').hide();
  $('#welcome').append(status);
  function setStatus(message) { status.text(message).attr('title', message); }
  function persist() {
    if (!attached) { return; }
    try {
      localStorage.setItem(key, JSON.stringify({content: CPO.editor.cm.getValue(), name: name, dirty: dirty}));
      persisted = true;
    } catch (_) { persisted = false; }
    if (!persisted) { setStatus('Local recovery unavailable — download a backup'); }
    else if (dirty) { setStatus('Saved on this device; not saved to Drive'); }
  }
  function adopt(p) {
    file = p;
    name = p.getName();
    options.updateName(p);
    return p;
  }
  function initial(fallback) {
    if (restored && typeof restored.content === 'string' && restored.dirty) {
      dirty = true;
      name = restored.name || name;
      options.setLocalName(name);
      setStatus('Recovered edits from this device; not saved to Drive');
      return Q(restored.content);
    }
    if (programId) {
      setStatus('Connect to Google Drive to open this program');
      return Q(fallback);
    }
    if (shareId) {
      return BrowserGoogleAuth.api.getSharedFileById(shareId, resourceKey)
        .then(function(p) { return p.getContents().then(function(contents) {
          adopt(p);
          setStatus('Viewing a shared program');
          return contents;
        }); }).catch(function(error) {
          setStatus(error.message || 'Could not open shared program. Connect with an account that has access.');
          return fallback;
        });
    }
    if (query.has('shareurl')) {
      return makeUrlFile(query.get('shareurl')).then(adopt).then(function(p) { return p.getContents(); })
        .catch(function() { setStatus('Could not open the program URL.'); return fallback; });
    }
    return Q(fallback);
  }
  function attach() {
    if (attached) { return; }
    attached = true;
    CPO.editor.cm.on('change', function() { dirty = true; persist(); });
    if (dirty) { persist(); }
    window.addEventListener('pagehide', persist);
  }
  function authUI() {
    var connected = !!BrowserGoogleAuth.current();
    $('.loginOnly').toggle(connected);
    $('.logoutOnly').toggle(!connected);
    $('#publishli').toggle(connected && !!file && !file.shared);
    $('#connectButton').prop('disabled', connecting).text(connecting ? 'Connecting…' : 'Connect to Google Drive');
    $('#connectButtonli').removeAttr('disabled');
    if (connected) { $('#filemenuContents .disabled').removeClass('disabled'); }
    else if (dirty) { persist(); }
    else { setStatus('Local editing — connect to save to Drive'); }
  }
  function connect(full) {
    connecting = true;
    var authorization = BrowserGoogleAuth.authorize(false, full);
    $('#connectButton').prop('disabled', true).text('Connecting…');
    return authorization.then(function() {
      return BrowserGoogleAuth.getAPI();
    }).then(function() {
      authUI();
      $('#username').text('Google Drive connected');
      // Reconnect must never replace locally edited contents with a remote copy.
      var requested = programId ? BrowserGoogleAuth.api.getFileById(programId, resourceKey) :
        shareId ? BrowserGoogleAuth.api.getSharedFileById(shareId, resourceKey) : Q(null);
      return requested.then(function(p) {
        if (!p) { return; }
        if (!dirty) {
          return p.getContents().then(function(contents) {
            adopt(p);
            if (!dirty) {
              CPO.editor.cm.setValue(contents);
              CPO.editor.cm.clearHistory();
              dirty = false;
              persist();
              setStatus(p.shared ? 'Viewing a shared program' : 'Loaded from Drive');
            }
          });
        } else { adopt(p); }
      });
    }).finally(function() {
      connecting = false;
      authUI();
    }).catch(function(error) {
      var message = error.message || 'Could not connect to Google Drive.';
      setStatus(message);
      window.stickError(message);
    });
  }
  function save(newName) {
    if (saving) { return newName === undefined ? saving : saving.then(function() { return save(newName); }); }
    persist();
    if (!BrowserGoogleAuth.current()) {
      window.stickError('Connect to Google Drive to save. Your edits remain in this tab' + (persisted ? ' and on this device.' : '. Download a backup.'));
      return Q.reject(new Error('Connect to Google Drive to save.'));
    }
    if (file && file.shared && newName === undefined) { return Q(file); }
    var contents = CPO.editor.cm.getValue();
    var oldKey = key;
    var target = newName !== undefined || (!file && !programId && !shareId) ?
      BrowserGoogleAuth.api.createFile(newName || name) :
      file ? Q(file) : programId ? BrowserGoogleAuth.api.getFileById(programId, resourceKey) :
      Q.reject(new Error('Use Save a copy to save changes to a shared program.'));
    setStatus('Saving to Drive…');
    saving = target.then(function(p) {
      // Retain a newly created file even if uploading fails, so retry updates it.
      adopt(p);
      programId = p.getUniqueId();
      shareId = null;
      resourceKey = p.getResourceKey();
      history.replaceState(null, '', '#program=' + encodeURIComponent(programId) +
        (resourceKey ? '&resourcekey=' + encodeURIComponent(resourceKey) : ''));
      key = namespace + 'program:' + programId;
      persist();
      if (persisted && oldKey !== key) {
        try { localStorage.removeItem(oldKey); } catch (_) {}
      }
      return p.save(contents, false);
    }).then(function(p) {
      adopt(p);
      dirty = CPO.editor.cm.getValue() !== contents;
      persist();
      if (!dirty) { setStatus('Saved to Drive'); }
      return p;
    }).catch(function(error) {
      if (error.code === 401 || error.status === 401) { BrowserGoogleAuth.clear(); }
      persist();
      window.stickError('Could not save to Drive. ' + (error.message || 'Check your connection and reconnect Google Drive.'));
      throw error;
    }).finally(function() { saving = null; });
    return saving;
  }
  function loadProgram(promise) {
    return promise.then(adopt).then(function(p) {
      return p.getContents().then(function(contents) {
        programId = p.shared ? null : p.getUniqueId();
        shareId = p.shared ? p.getUniqueId() : null;
        key = namespace + (p.shared ? 'share:' : 'program:') + p.getUniqueId();
        dirty = false;
        return contents;
      });
    });
  }
  window.addEventListener('google-auth-changed', authUI);
  $('#logout a').attr('href', '#').text('Disconnect Google Drive').on('click', function(e) {
    e.preventDefault();
    BrowserGoogleAuth.clear();
  });
  $('#logging').hide();
  var localInput = $('<input type="file" accept=".arr,.txt,text/plain" id="local-file-input">').hide();
  var localOpen = $('<a href="#" class="focusable" role="menuitem" tabindex="-1">').text('Open local file');
  $('#new').closest('li').after($('<li role="presentation">').append(
    $('<div class="menuButton">').append(localOpen, localInput)));
  localOpen.on('click', function(e) { e.preventDefault(); localInput[0].click(); });
  localInput.on('change', function() {
    var selected = this.files[0];
    if (!selected) { return; }
    var reader = new FileReader();
    reader.onerror = function() { window.stickError('Could not read the selected file.'); };
    reader.onload = function() {
      persist();
      file = null;
      programId = null;
      shareId = null;
      resourceKey = null;
      name = selected.name;
      var id = window.crypto.randomUUID();
      key = namespace + 'draft:' + id;
      history.replaceState(null, '', '#draft=' + id);
      options.setLocalName(name);
      CPO.editor.cm.setValue(String(reader.result));
      CPO.editor.cm.clearHistory();
      dirty = true;
      persist();
      authUI();
      localInput.val('');
    };
    reader.readAsText(selected);
  });
  $('#fullConnectButton a').text('Enable Google Sheets access');
  $('#programs').addClass('loginOnly');
  $('#programs a').attr('href', '#').removeAttr('target');
  var picker = new FilePicker({views: ['pyretView'], title: 'Open a Pyret program',
    onLoaded: function() {
      $('#programs a').on('click', function(e) { e.preventDefault(); picker.open(); });
    },
    onSelect: function(files, googlePicker) {
      persist();
      var picked = files[0];
      location.assign(window.APP_BASE_URL + '/editor/#program=' + encodeURIComponent(picked[googlePicker.Document.ID]) +
        (picked.resourceKey ? '&resourcekey=' + encodeURIComponent(picked.resourceKey) : ''));
    },
    onError: function(error) { window.stickError(String(error)); }
  });
  BrowserGoogleAuth.load().catch(function() {});
  authUI();
  return { initial: initial, attach: attach, connect: connect, save: save,
    loadProgram: loadProgram, currentFile: function() { return Q(file); },
    renamed: function(p) { adopt(p); persist(); },
    autoSave: function() {
      persist();
      if (dirty && file && !file.shared && BrowserGoogleAuth.current()) { save().catch(function() {}); }
    } };
};
