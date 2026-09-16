/* Browser-only Google authorization. Access tokens deliberately stay in memory. */
(function() {
  if (!window.CLIENT_SIDE) { return; }
  var ready, token, expiresAt = 0, pending, tokenClient, expiryTimer;
  // drive.file permits saves; drive.readonly lets a recipient open an existing
  // shared link without first selecting that file in Google Picker.
  var scopes = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';

  function announce() {
    window.dispatchEvent(new CustomEvent('google-auth-changed'));
  }
  function clear() {
    token = null;
    expiresAt = 0;
    clearTimeout(expiryTimer);
    if (window.gapi && gapi.client) { gapi.client.setToken(null); }
    announce();
  }
  function current() {
    if (token && Date.now() >= expiresAt) { clear(); }
    return token;
  }
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      var timer = setTimeout(function() { reject(new Error('Google did not respond. Try connecting again.')); }, 15000);
      script.src = src;
      script.onload = function() { clearTimeout(timer); resolve(); };
      script.onerror = function() { clearTimeout(timer); reject(new Error('Could not load Google. Check your connection.')); };
      document.head.appendChild(script);
    });
  }
  function load() {
    if (ready) { return ready; }
    if (!window.GOOGLE_CLIENT_ID || !window.apiKey) {
      return Q.reject(new Error('Google Drive is not configured for this deployment. Use Download to save your program.'));
    }
    ready = Q(Promise.all([
      window.gapi && gapi.client ? Promise.resolve() : loadScript('https://apis.google.com/js/api.js').then(function() {
        return new Promise(function(resolve, reject) {
          gapi.load('client', { callback: resolve, onerror: reject, timeout: 15000,
            ontimeout: function() { reject(new Error('Google API client timed out.')); } });
        });
      }),
      window.google && google.accounts ? Promise.resolve() : loadScript('https://accounts.google.com/gsi/client')
    ])).then(function() {
      gapi.client.setApiKey(apiKey);
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: window.GOOGLE_CLIENT_ID,
        scope: scopes,
        callback: function(response) {
          if (!pending) { return; }
          var request = pending;
          pending = null;
          if (response.error || !response.access_token) {
            request.reject(new Error(response.error_description || response.error || 'Google authorization failed.'));
            return;
          }
          var granted = (response.scope || '').split(/\s+/);
          if (!scopes.split(' ').every(function(scope) { return granted.indexOf(scope) >= 0; })) {
            request.reject(new Error('Google access was not fully granted. Reconnect and allow the requested Drive permissions and Sheets permission if enabled.'));
            return;
          }
          token = { access_token: response.access_token };
          expiresAt = Date.now() + Math.max(0, Number(response.expires_in) - 30) * 1000;
          gapi.client.setToken(token);
          clearTimeout(expiryTimer);
          expiryTimer = setTimeout(clear, Math.max(0, expiresAt - Date.now()));
          request.resolve(token);
          announce();
        },
        error_callback: function(error) {
          if (pending) {
            pending.reject(new Error(error.type === 'popup_closed' ? 'Google connection cancelled.' : 'Could not open Google authorization. Please try again.'));
            pending = null;
          }
        }
      });
    }).catch(function(error) { ready = null; throw error; });
    return ready;
  }
  function authorize(immediate, full) {
    if (immediate) { return Q(current()); }
    // The libraries are preloaded. Keep requestAccessToken in the click stack.
    if (!tokenClient) {
      return load().then(function() { throw new Error('Google is ready. Click Connect to Google Drive again.'); });
    }
    if (pending) { return pending.promise; }
    pending = Q.defer();
    var result = pending.promise;
    if (full && scopes.indexOf('spreadsheets') < 0) { scopes += ' https://www.googleapis.com/auth/spreadsheets'; }
    try { tokenClient.requestAccessToken({ scope: scopes, prompt: '' }); }
    catch (error) { pending.reject(error); pending = null; }
    return result;
  }
  var apiPromise;
  function getAPI() {
    if (!apiPromise) {
      apiPromise = load().then(function() {
        return createProgramCollectionAPI('code.pyret.org', true, !current());
      }).catch(function(error) { apiPromise = null; throw error; });
    }
    return apiPromise;
  }
  window.addEventListener('google-auth-changed', function() { apiPromise = null; });
  var api = {};
  ['getCollectionLink', 'getCollectionFolderId', 'getFileById', 'makeUrlFile', 'getFileByName',
    'getCachedFileByName', 'getSharedFileById', 'getFiles', 'getCachedFiles', 'getAllFiles',
    'createFile', 'checkLogin'].forEach(function(name) {
    api[name] = function() {
      var args = arguments;
      return getAPI().then(function(storage) { return storage.api[name].apply(storage.api, args); });
    };
  });
  window.BrowserGoogleAuth = { load: load, authorize: authorize, current: current,
    clear: clear, getAPI: getAPI, api: api };
})();
