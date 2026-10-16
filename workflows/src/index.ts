/**
 * Render Workflows entrypoint (start command: `node dist/index.js`).
 *
 * Importing the task modules registers every task synchronously; when Render runs this file it sets
 * RENDER_SDK_SOCKET_PATH and the SDK auto-starts the task server after registration (no start() call
 * is needed in the TypeScript SDK). Locally: `npm run dev` (uses `render workflows dev`).
 *
 * Tasks (slug = <workflow-slug>/<name>):
 *   nightlyReconcile   reconcileWindow   recheckAfterLag
 *   unclaimedSweep     renotifyUnclaimed
 *   refreshReport      alertOrganizers   smokeTest
 *   nightlyDemoReset   (hosted demo only, DEMO_RESET_HOUR_UTC)
 */
import './tasks/alerts.js';
import './tasks/reconcile.js';
import './tasks/unclaimed.js';
import './tasks/report.js';
import './tasks/smoke.js';
import './tasks/demo.js';
