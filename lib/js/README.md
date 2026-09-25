jquery from https://ajax.googleapis.com/ajax/libs/jquery/1.10.2/jquery.min.js
jquery-ui from https://ajax.googleapis.com/ajax/libs/jqueryui/1.10.4/jquery-ui.min.js
../images/ from https://jqueryui.com/download/all/, version 1.14.1

Vega (BSD3): https://www.npmjs.com/package/vega, via https://cdn.jsdelivr.net/npm/vega@6.1.2/build/vega.min.js
Vega Tooltip (BSD3): https://www.npmjs.com/package/vega-tooltip, via https://cdnjs.cloudflare.com/ajax/libs/vega-tooltip/1.0.0-alpha.2/vega-tooltip.min.js

`spytial-pyret-capture.js` is the headless capture entry built from Spytial-Core.
Its exact source revision and bundle hash are in `spytial-pyret-capture.json`;
licenses are in `spytial-pyret-capture.LICENSE.txt`. Regenerate from a committed
Core checkout with `node src/scripts/update-pyret-capture.js /path/to/core`.
This local asset separates capture updates from the pinned layout/UI bundles.
