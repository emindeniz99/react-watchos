import { createServer } from "node:http";

// Remote inspector server. A DEBUG watch build (startInspector) POSTs
// snapshots here; open http://127.0.0.1:8099 in a browser to watch the live
// React tree + console logs. The watch simulator shares the Mac's network,
// so 127.0.0.1 works.
const PORT = Number(process.env.INSPECTOR_PORT ?? 8099);
let latest = { commits: 0, tree: null, logs: [], at: 0 };

const PAGE = `<!doctype html><meta charset=utf8><title>react-native-watchos inspector</title>
<style>body{font:13px ui-monospace,monospace;margin:0;background:#111;color:#ddd}
header{padding:8px 12px;background:#1e1e1e;border-bottom:1px solid #333}
.cols{display:flex;height:calc(100vh - 40px)}.col{flex:1;overflow:auto;padding:12px}
.col+.col{border-left:1px solid #333}pre{white-space:pre-wrap;margin:0}
.log{color:#9cdcfe}.muted{color:#888}h2{font-size:12px;color:#888;margin:0 0 8px}</style>
<header>react-native-watchos inspector <span class=muted id=meta></span></header>
<div class=cols>
  <div class=col><h2>TREE</h2><pre id=tree></pre></div>
  <div class=col><h2>LOGS</h2><pre id=logs></pre></div>
</div>
<script>
async function tick(){
  try{
    const r = await fetch('/snapshot'); const s = await r.json();
    document.getElementById('meta').textContent =
      'commits=' + s.commits + (s.at ? ' · ' + new Date(s.at).toLocaleTimeString() : ' · waiting…');
    document.getElementById('tree').textContent = s.tree ? JSON.stringify(s.tree, null, 2) : '(no tree yet)';
    document.getElementById('logs').innerHTML = (s.logs||[]).map(l =>
      '<div class=log>'+l.replace(/[&<]/g,c=>c==='&'?'&amp;':'&lt;')+'</div>').join('');
  }catch(e){}
}
setInterval(tick, 800); tick();
</script>`;

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "POST" && req.url === "/snapshot") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        latest = { ...JSON.parse(body), at: Date.now() };
      } catch {
        /* ignore bad payloads */
      }
      res.end("ok");
    });
    return;
  }
  if (req.url === "/snapshot") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(latest));
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(PAGE);
}).listen(PORT, () => {
  console.log(`inspector: http://127.0.0.1:${PORT}  (watch posts to /snapshot)`);
});
