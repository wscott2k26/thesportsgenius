// Server entrypoint.
import 'dotenv/config';
import app from './app.js';
import { reconcileRecentPicks } from './picks.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[sports-genius] listening on :${PORT}`);
});

reconcileRecentPicks().catch(e=>console.error("[sports-genius] history reconciliation",e.message));
setInterval(()=>reconcileRecentPicks().catch(e=>console.error("[sports-genius] history reconciliation",e.message)),60*60*1000).unref();
