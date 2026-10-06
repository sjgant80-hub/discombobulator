// build-page.mjs — generate the kernel-backed live page. It INLINES the real kernel
// source (features/understand/confirm/verify/migrate/ingest) so the logic running in
// the browser IS the gated logic (one-kernel-rule: facts generated, never typed), plus
// the real legacy data and a faithful ES-module legacy engine. `node build-page.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const R = (p) => readFileSync(join(here, p), 'utf8');

// strip ES module plumbing so files concatenate into one <script type=module>
function strip(src) {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*import\s/.test(l))
    .filter((l) => !/^\s*export\s+default\s/.test(l))
    .map((l) => l.replace(/^(\s*)export\s+/, '$1'))
    .join('\n');
}

const ROUND = 'function round(v) { return Math.round(v * 1000) / 1000; }';
let kernels = ['kernel/features.mjs', 'kernel/understand.mjs', 'kernel/confirm.mjs', 'kernel/verify.mjs', 'kernel/migrate.mjs', 'kernel/ingest.mjs']
  .map((p) => `// ===== ${p} =====\n${strip(R(p))}`).join('\n\n');
// `round` is defined identically in several kernels — keep a single definition in the
// shared module scope and drop the per-file copies to avoid a redeclaration SyntaxError.
kernels = ROUND + '\n' + kernels.split(ROUND).join('');

const legacyPort = strip(R('legacy/engine.browser.mjs'));
// Only the κ-codec primitives from SENTINEL are needed for the live tamper demo
// (pack/unpack/foldWitness) — inlined minimally to avoid name clashes with the
// kernels. Thomas Frumkin's primorial-fold codec; see kernel/sentinel.mjs for the
// full signed-packet gate (proven in the Node suite & CI).
const sentinel = `
const KAPPA_SPINE=[2,3,5,11,31], KAPPA_PAYLOAD=6;
function foldWitness(bytes){ let w=0; for(let i=0;i<KAPPA_SPINE.length;i++) w+=KAPPA_SPINE[i]*(((bytes&&bytes[i])|0)&0xFF); return w&0xFF; }
function pack(c){ if(!c||typeof c!=='object') return null; const b=new Uint8Array(KAPPA_PAYLOAD); b[0]=c.opcode&0xFF; b[1]=((c.source&0xF)<<4)|(c.target&0xF); b[2]=c.resources&0xFF; b[3]=c.budget&0xFF; b[4]=(c.budget>>8)&0xFF; b[5]=foldWitness(b); return b; }
function unpack(b){ if(!(b instanceof Uint8Array)||b.length!==KAPPA_PAYLOAD) return {ok:false,reason:'bad-length'}; if(b[5]!==foldWitness(b)) return {ok:false,reason:'off-kappa'}; return {ok:true}; }`;

const records = R('legacy/records.json').trim();
const config = R('legacy/config.json').trim();
const confirmed = R('confirmed-rules.json').trim();

// a browser checksum shim for migrate (node:crypto is unavailable in the browser);
// deterministic FNV-1a hex so the integrity checks stay internally consistent.
const cryptoShim = `
function createHash(){ let h=0x811c9dc5>>>0,acc=''; return {
  update(s){ acc+=String(s); return this; },
  digest(){ h=0x811c9dc5>>>0; for(let i=0;i<acc.length;i++){ h^=acc.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return (h>>>0).toString(16).padStart(8,'0'); }
}; }`;

// a browser grow (decide only) using the inlined organs — mirrors regrow.decide
const browserGrow = `
function growBrowser(spec){
  const corrections=(spec.corrections&&spec.corrections.tree)?spec.corrections:null;
  const confirmedRules=Array.isArray(spec.confirmedRules)?spec.confirmedRules:[];
  function decide(app){ const x=featurize(app); if(!x) return {status:'DECLINE',tier:null};
    const base=predictSpec(spec,x); const corrected=applyCorrections(base,x,corrections);
    return applyConfirmed(decisionOf(corrected),x,confirmedRules); }
  return { decide, organs: spec.featuresUsed||[] };
}
function rowToApplicant(row){ return { id:row.APPLICANT_ID, age:row.APP_AGE, income:row.GROSS_INC, debt:row.TOT_DEBT, loanAmount:row.LOAN_AMT, employmentYears:row.EMP_YRS, creditScore:row.CR_SCORE, priorDefaults:row.PRIOR_DEF, region:row.REGION_CD, product:row.PROD_CD, applyDate:row.APPLY_DT }; }`;

// the live pipeline runner (mirrors kernel/pipeline.mjs orchestration)
const runner = `
function discombobulate(){
  const legacyDecide = makeLegacy(CONFIG);
  const corpus=[], testCases=[];
  for(const row of RECORDS){ const app=rowToApplicant(row); const d=legacyDecide(app); const x=featurize(app);
    const slice=splitOf(app.id); const entry={id:app.id,x,y:labelOf(d),slice,applicant:app};
    if(slice==='test') testCases.push(app); else corpus.push(entry); }
  const spec=understand(corpus);
  const base=growBrowser(spec);
  const vBase=verifyEquivalent(legacyDecide, base.decide, testCases);
  const val=corpus.filter(c=>c.slice==='validate');
  const mined=mineCorrections((x)=>predictSpec(spec,x), val);
  const corrections=mined.ok?mined.corrections:null;
  const autoBuild=growBrowser({...spec,corrections});
  const vAuto=verifyEquivalent(legacyDecide, autoBuild.decide, testCases);
  const human=growBrowser({...spec,corrections,confirmedRules:CONFIRMED});
  const vHuman=verifyEquivalent(legacyDecide, human.decide, testCases);
  const mig=migrate(RECORDS);
  const counts={ total:RECORDS.length, fit:corpus.filter(c=>c.slice==='fit').length, validate:val.length, test:testCases.length };
  return { counts, spec, vBase, vAuto, vHuman, mig, autoRules:(corrections?corrections.rules:[]), confirmedIds:CONFIRMED.map(r=>r.id) };
}
// SENTINEL κ-witness tamper demo (pure, browser-safe)
function kappaDemo(tamper){
  const p=pack({opcode:1,source:1,target:0,resources:1,budget:1});
  if(!p) return {ok:false};
  const bytes=Uint8Array.from(p); if(tamper) bytes[2]^=0x20;
  const u=unpack(bytes);
  return { bytes:[...bytes], witness:bytes[5], recomputed:foldWitness(bytes), ok:u.ok, reason:u.reason };
}`;

const script = `${cryptoShim}\n\n${kernels}\n\n// ===== legacy engine (browser port) =====\n${legacyPort}\n\n// ===== SENTINEL (primorial-fold codec, Thomas Frumkin) =====\n${sentinel}\n\n${browserGrow}\n\nconst RECORDS=${records};\nconst CONFIG=${config};\nconst CONFIRMED=${confirmed};\n${runner}`;

const html = pageHtml(script);
writeFileSync(join(here, 'index.html'), html);
console.log('wrote index.html (' + html.length + ' bytes)');

function pageHtml(scriptBody) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Discombobulator</title>
<meta name="description" content="Legacy software to FallWorld-native sovereign RE-GROWTH: ingest a system, understand what it does, re-grow it sovereign, PROVE equivalence on real cases, migrate the data. Runs live in your browser on the real kernels.">
<link rel="canonical" href="https://sjgant80-hub.github.io/discombobulator/">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"The Discombobulator","applicationCategory":"DeveloperApplication","operatingSystem":"Any (web)","description":"Legacy software to sovereign re-growth pipeline: ingest, understand, re-grow, prove-equivalent, migrate. Functionally equivalent and structurally superior, proven on real held-out cases.","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"creator":{"@type":"Organization","name":"sjgant80-hub"}}
</script>
<style>
:root{
  --bg:#0b0f14; --panel:#121a24; --panel2:#0f1620; --ink:#e8eef5; --mut:#9fb0c3; --line:#243244;
  --acc:#4cc2ff; --acc2:#7ea8ff; --good:#3ad29f; --warn:#ffcf5c; --bad:#ff6b6b; --chip:#1b2836;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
}
:root{--acc2:#7ea8ff;}
@media (prefers-color-scheme: light){ :root:not([data-theme="dark"]){
  --bg:#f3f6fa; --panel:#ffffff; --panel2:#eef3f9; --ink:#15202b; --mut:#52657a; --line:#d9e2ec; --chip:#eef3f9;
}}
:root[data-theme="light"]{ --bg:#f3f6fa; --panel:#ffffff; --panel2:#eef3f9; --ink:#15202b; --mut:#52657a; --line:#d9e2ec; --chip:#eef3f9; }
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1000px;margin:0 auto;padding:28px 16px 80px}
header h1{font-size:clamp(28px,5vw,44px);margin:.2em 0 .1em;letter-spacing:-.02em}
header p.lead{color:var(--mut);font-size:clamp(15px,2.3vw,18px);margin:.2em 0 1.2em;max-width:70ch}
.tag{display:inline-block;font:600 11px/1 var(--mono);color:var(--acc);background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:6px 10px;margin:0 6px 8px 0;letter-spacing:.04em}
.btn{appearance:none;cursor:pointer;font:600 15px var(--sans);color:#04121c;background:linear-gradient(180deg,var(--acc),#2aa9ee);border:0;border-radius:12px;padding:13px 22px;box-shadow:0 6px 24px rgba(76,194,255,.25)}
.btn:active{transform:translateY(1px)}
.btn.sec{background:var(--panel);color:var(--ink);border:1px solid var(--line);box-shadow:none}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:8px 0 22px}
.stages{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:14px 0}
.stage{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;opacity:.5;transition:opacity .3s,border-color .3s}
.stage.on{opacity:1;border-color:var(--acc)}
.stage .n{font:700 12px var(--mono);color:var(--acc)}
.stage h3{margin:.3em 0 .2em;font-size:15px}
.stage .d{color:var(--mut);font-size:12.5px;min-height:34px}
.stage .v{font:600 13px var(--mono);margin-top:6px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px 18px;margin:16px 0}
.panel h2{margin:.1em 0 .5em;font-size:19px}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:6px 0}
.kpi{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center}
.kpi .big{font:800 clamp(22px,5vw,34px)/1 var(--sans)}
.kpi .lab{color:var(--mut);font-size:12px;margin-top:4px}
.arrow{color:var(--mut);text-align:center;font-size:13px;margin:2px 0}
table{width:100%;border-collapse:collapse;font:13px var(--mono);margin-top:8px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:600}
.pill{display:inline-block;border-radius:6px;padding:1px 7px;font:600 11px var(--mono)}
.pill.g{background:rgba(58,210,159,.16);color:var(--good)}
.pill.b{background:rgba(255,107,107,.16);color:var(--bad)}
.pill.w{background:rgba(255,207,92,.16);color:var(--warn)}
code{font-family:var(--mono);background:var(--chip);padding:1px 5px;border-radius:5px;font-size:12.5px}
.muted{color:var(--mut)} .mono{font-family:var(--mono)}
.note{color:var(--mut);font-size:13px;border-left:2px solid var(--line);padding-left:12px;margin:12px 0}
footer{margin-top:40px;color:var(--mut);font-size:12.5px;border-top:1px solid var(--line);padding-top:16px}
footer a{color:var(--acc2)}
.defense{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:620px){.defense{grid-template-columns:1fr}.kpis{grid-template-columns:1fr}}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--acc);border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px}
@keyframes s{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <span class="tag">INGEST</span><span class="tag">UNDERSTAND</span><span class="tag">RE-GROW</span><span class="tag">VERIFY-EQUIVALENT</span><span class="tag">MIGRATE</span>
  </div>
  <h1>The Discombobulator</h1>
  <p class="lead">Feed it a legacy system. It works out what the software <em>does</em> (not how it's coded), re-grows a sovereign build that does the same job, <strong>proves equivalence on the system's own held-out cases</strong>, and migrates the data across. Not a copier &mdash; a re-grower: functionally equivalent, structurally superior, owned by you. Everything below runs live in your browser on the real gated kernels.</p>
  <div class="row">
    <button class="btn" id="run">&#9654;&nbsp; Re-grow the legacy system</button>
    <span class="muted" id="status">Proof target: <strong>LoanDesk&nbsp;2011</strong>, an undocumented 1,200-record credit-decision engine.</span>
  </div>
  <p class="note" style="margin-top:14px;border-left:3px solid var(--accent,#6a3bdb);padding:10px 14px;background:rgba(106,59,219,.07);border-radius:8px">
    <strong>&#9654; Bring your OWN legacy system.</strong> This page proves the method on a sealed demo.
    To run it on your own decision log &mdash; drop a CSV, re-grow a replacement, download a model you own &mdash;
    open <a href="./app.html"><strong>the live tool &rarr;</strong></a> (100% in your browser, nothing uploads).
  </p>
</header>

<div class="stages" id="stages">
  <div class="stage" data-k="1"><div class="n">STAGE 1</div><h3>Ingest</h3><div class="d">Inventory the code, config, schema &amp; data; sample the legacy as a black-box oracle.</div><div class="v" id="s1"></div></div>
  <div class="stage" data-k="2"><div class="n">STAGE 2</div><h3>Understand</h3><div class="d">Induce the decision function as two grown organs; flag low-confidence patterns.</div><div class="v" id="s2"></div></div>
  <div class="stage" data-k="3"><div class="n">STAGE 3</div><h3>Re-grow</h3><div class="d">Grow a sovereign, SENTINEL-defended, compressed build from the spec.</div><div class="v" id="s3"></div></div>
  <div class="stage" data-k="4"><div class="n">STAGE 4</div><h3>Verify-equivalent</h3><div class="d">Run the real held-out cases through old vs new; surface every mismatch.</div><div class="v" id="s4"></div></div>
  <div class="stage" data-k="5"><div class="n">STAGE 5</div><h3>Migrate</h3><div class="d">Schema-transform the records; count / null / checksum / roundtrip checks.</div><div class="v" id="s5"></div></div>
</div>

<div class="panel" id="equiv" style="display:none">
  <h2>Does it do what the old software did?</h2>
  <div class="kpis">
    <div class="kpi"><div class="big" id="kBase">&mdash;</div><div class="lab">automated organ (first pass)</div></div>
    <div class="kpi"><div class="big" id="kAuto">&mdash;</div><div class="lab">+ automated carry (gate-driven)</div></div>
    <div class="kpi"><div class="big" id="kHuman">&mdash;</div><div class="lab">+ human-confirmed tribal rules</div></div>
  </div>
  <div class="arrow">equivalence on the legacy's own held-out cases &mdash; higher is more faithful</div>
  <p class="note" id="equivNote"></p>
</div>

<div class="panel" id="miss" style="display:none">
  <h2>What didn't come across &mdash; flagged, never hidden</h2>
  <p class="muted" id="missLead"></p>
  <table id="missTable"><thead><tr><th>id</th><th>legacy said</th><th>re-grown said</th><th>the gate's attribution</th></tr></thead><tbody></tbody></table>
  <p class="note">The gate returns <strong>every</strong> case where old and new differ and attributes each to a candidate tribal rule. That short, pinpointed list is what turns blind reverse-engineering into a minutes-long human confirm &mdash; the hard-20% made visible, not silently lost.</p>
</div>

<div class="panel" id="defense" style="display:none">
  <h2>Structurally superior, not just equivalent</h2>
  <p class="muted">The legacy accepts any call that reaches it. The re-grown build routes every decision as a signed, &kappa;-witnessed SENTINEL packet (Thomas Frumkin's primorial-fold codec) and rejects what the legacy could never see. Live &kappa;-witness check:</p>
  <div class="defense">
    <div class="kpi"><div class="big" id="dClean">&mdash;</div><div class="lab" id="dCleanL">untampered packet</div></div>
    <div class="kpi"><div class="big" id="dTamp">&mdash;</div><div class="lab" id="dTampL">one byte flipped</div></div>
  </div>
  <p class="note" id="defNote"></p>
</div>

<div class="panel">
  <h2>What v1 is &mdash; honestly</h2>
  <p class="muted">v1 is a <strong>guided pipeline</strong>, not a one-click vending machine. The common rules extract automatically; the gnarly, undocumented ones are flagged for a human to confirm in a moment. Some things don't translate at all (deep platform deps, hardware-bound logic) and would be bridged, not re-grown &mdash; flagged up front. Automation deepens as the pattern library grows. The un-forgeable proof is the CI re-run on GitHub's own runner, re-derived from the sealed inputs; this page is the live demonstration.</p>
</div>

<footer>
  <p><strong>The Discombobulator</strong> &mdash; legacy &rarr; sovereign re-growth. The gate is the safety: nothing silently missed.</p>
  <p>Built on the Konomi architecture and LIGHT, created by <strong>Thomas Frumkin</strong> (primorial-fold codec in SENTINEL, used with the Konomi lineage). Organs reuse <strong>pattern-organs</strong> (the Pattern Organ &amp; held-out prove-gate) and <strong>fall-spore</strong> (grow-from-seed), both sjgant80-hub. Equivalence enforced by the <strong>witness</strong> mutation gate. Legacy "LoanDesk 2011" is a synthetic proof target.</p>
</footer>
</div>

<script type="module">
${scriptBody}

const $=(id)=>document.getElementById(id);
const pct=(v)=>v.toFixed(1)+'%';
function light(k){ document.querySelector('.stage[data-k="'+k+'"]').classList.add('on'); }
function reset(){ for(const s of document.querySelectorAll('.stage')) s.classList.remove('on'); for(const id of ['s1','s2','s3','s4','s5']) $(id).textContent=''; }

async function run(){
  reset();
  $('run').disabled=true; $('status').innerHTML='<span class="spin"></span> growing &hellip;';
  await new Promise(r=>setTimeout(r,60));
  const t0=performance.now();
  const r=discombobulate();
  const ms=Math.round(performance.now()-t0);

  light(1); $('s1').textContent=r.counts.total+' records · '+r.counts.test+' held out';
  await step();
  light(2); $('s2').innerHTML=r.spec.counts.leaves+' leaves · '+r.spec.counts.flagged+' flagged<br><span class="muted">organs: '+r.spec.featuresUsed.length+'</span>';
  await step();
  light(3); $('s3').innerHTML='sovereign build · κ-defended<br><span class="muted">'+r.spec.featuresUsed.length+' organs grown</span>';
  await step();
  light(4); $('s4').innerHTML=pct(r.vHuman.equivalencePct)+' equivalent<br><span class="muted">'+r.vHuman.mismatchCount+' residual, all flagged</span>';
  await step();
  light(5); $('s5').innerHTML=(r.mig.pass?'<span class="pill g">INTEGRITY PASS</span>':'<span class="pill b">FAIL</span>')+'<br><span class="muted">'+r.mig.migrated+'/'+r.mig.source+' records</span>';

  // equivalence KPIs
  $('equiv').style.display='';
  $('kBase').textContent=pct(r.vBase.equivalencePct);
  $('kAuto').textContent=pct(r.vAuto.equivalencePct);
  $('kHuman').textContent=pct(r.vHuman.equivalencePct);
  const resid=r.vHuman.mismatchCount;
  $('equivNote').innerHTML='The automated organ reproduces <strong>'+pct(r.vBase.equivalencePct)+'</strong> of the legacy\\'s held-out decisions on its own. The gate-driven carry lifts it to <strong>'+pct(r.vAuto.equivalencePct)+'</strong>. After a human confirms the '+r.confirmedIds.length+' tribal rules the gate pinpointed, it reaches <strong>'+pct(r.vHuman.equivalencePct)+'</strong> &mdash; the remaining '+resid+' cases are continuous-ratio boundary approximation, every one flagged. Ran in '+ms+' ms.';

  // mismatches
  $('miss').style.display='';
  const hist=r.vHuman.attributionHistogram; const parts=Object.keys(hist).map(k=>k+'×'+hist[k]).join(', ');
  $('missLead').innerHTML='Base pass flagged <strong>'+r.vBase.mismatchCount+'</strong> mismatches ('+Object.entries(r.vBase.attributionHistogram).map(([k,v])=>k+'×'+v).join(', ')+'). After the guided loop, '+resid+' remain: '+(parts||'none')+'.';
  const tb=$('missTable').querySelector('tbody'); tb.innerHTML='';
  for(const m of r.vBase.mismatches.slice(0,10)){
    const tr=document.createElement('tr');
    tr.innerHTML='<td>'+m.id+'</td><td>'+m.legacy.status+'|'+(m.legacy.tier||'·')+'</td><td>'+m.regrown.status+'|'+(m.regrown.tier||'·')+'</td><td><span class="pill '+(m.attribution[0]==='unattributed'?'w':'b')+'">'+m.attribution.join(', ')+'</span></td>';
    tb.appendChild(tr);
  }

  // defense demo
  $('defense').style.display='';
  const clean=kappaDemo(false), tamp=kappaDemo(true);
  $('dClean').innerHTML=clean.ok?'<span style="color:var(--good)">ACCEPTED</span>':'<span style="color:var(--bad)">REJECTED</span>';
  $('dCleanL').textContent='untampered · κ '+clean.witness+' = fold '+clean.recomputed;
  $('dTamp').innerHTML=tamp.ok?'<span style="color:var(--bad)">ACCEPTED</span>':'<span style="color:var(--good)">REJECTED: '+tamp.reason+'</span>';
  $('dTampL').textContent='byte flipped · κ '+tamp.witness+' ≠ fold '+tamp.recomputed;
  $('defNote').innerHTML='A tampered packet no longer folds to its κ-witness, so it reads off-κ and never becomes a command. The full build also verifies an Ed25519 signature before the payload is parsed and rejects replays and over-budget calls (proven in the Node suite &amp; CI).';

  $('status').innerHTML='Done &mdash; re-grown &amp; proven in '+ms+' ms. <button class="btn sec" onclick="void 0" id="noop" style="display:none"></button>';
  $('run').disabled=false; $('run').innerHTML='&#8635;&nbsp; Run again';
}
function step(){ return new Promise(r=>setTimeout(r,230)); }
$('run').addEventListener('click',run);
</script>
</body>
</html>`;
}
