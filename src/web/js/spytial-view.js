/* Host-owned display handles use standard Pyret opaque values. */
define('cpo/spytial-view', [], function () {
  'use strict';
  var views = new WeakMap();
  return {
    make: function (container) {
      var handle = {};
      views.set(handle, container);
      return handle;
    },
    isView: function (handle) { return !!handle && typeof handle === 'object' && views.has(handle); },
    render: function (handle) { return views.get(handle); }
  };
});
