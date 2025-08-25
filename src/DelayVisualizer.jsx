import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import "./dv.css";

const kb = 1024;
const Mb = 1_000_000; 
const km = 1000; 

function fmtMs(x) {
  if (!isFinite(x)) return "∞";
  if (x < 1) return `${(x * 1000).toFixed(2)} µs`;
  if (x < 1000) return `${x.toFixed(3)} ms`;
  return `${(x / 1000).toFixed(3)} s`;
}
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

const PROP_SPEEDS = {
  Fiber: 2.0e8, 
  Coax: 2.0e8,
  "Twisted Pair": 2.0e8,
  "Free Space (RF)": 3.0e8,
};

const PRESETS = {
  "HFC (Cable)": {
    rateMbps: 300, packetKB: 1.5, distanceKm: 20, medium: "Coax",
    hops: 8, procUsPerHop: 50, queueMsPerHop: 0.2, queueModel: "Fixed", utilization: 0.5,
  },
  "DSL (VDSL2)": {
    rateMbps: 50, packetKB: 1.5, distanceKm: 5, medium: "Twisted Pair",
    hops: 6, procUsPerHop: 50, queueMsPerHop: 0.3, queueModel: "Fixed", utilization: 0.6,
  },
  "FTTH (GPON)": {
    rateMbps: 1000, packetKB: 1.5, distanceKm: 30, medium: "Fiber",
    hops: 10, procUsPerHop: 40, queueMsPerHop: 0.1, queueModel: "Fixed", utilization: 0.35,
  },
  "4G LTE": {
    rateMbps: 75, packetKB: 1.5, distanceKm: 3, medium: "Free Space (RF)",
    hops: 12, procUsPerHop: 80, queueMsPerHop: 0.8, queueModel: "Fixed", utilization: 0.7,
  },
  "5G (mid-band)": {
    rateMbps: 400, packetKB: 1.5, distanceKm: 2, medium: "Free Space (RF)",
    hops: 12, procUsPerHop: 60, queueMsPerHop: 0.4, queueModel: "Fixed", utilization: 0.5,
  },
};

const DEFAULT_SCENARIO = {
  name: "Scenario",
  packetKB: 1.5,
  rateMbps: 1000,
  distanceKm: 10,
  medium: "Fiber",
  hops: 10,
  procUsPerHop: 50,
  queueMsPerHop: 0.2,
  queueModel: "Fixed", 
  utilization: 0.5,    
};

function computeMetrics(s) {
  const bits = s.packetKB * kb * 8;
  const rate = s.rateMbps * Mb;
  const distanceM = s.distanceKm * km;
  const propSpeed = PROP_SPEEDS[s.medium];

  const txPerHop_s = bits / rate; 
  const txPerHop_ms = txPerHop_s * 1000;
  let queuePerHop_ms = s.queueMsPerHop;
  if (s.queueModel === "MM1") {
    const mu = rate / bits;
    const rho = clamp(s.utilization, 0, 0.98); 
    const lambda = rho * mu;
    const Wq_s = rho / (mu - lambda);
    queuePerHop_ms = Wq_s * 1000;
  }

  const dTransTotalMs = txPerHop_ms * s.hops;
  const dPropMs = (distanceM / propSpeed) * 1000;
  const dProcTotalMs = (s.procUsPerHop / 1000) * s.hops;
  const dQueueTotalMs = queuePerHop_ms * s.hops;
  const totalMs = dTransTotalMs + dPropMs + dProcTotalMs + dQueueTotalMs;

  const parts = [
    { key: "tx", label: "Transmission (all hops)", value: dTransTotalMs },
    { key: "prop", label: "Propagation (total)", value: dPropMs },
    { key: "proc", label: "Processing (all hops)", value: dProcTotalMs },
    { key: "queue", label: "Queuing (all hops)", value: dQueueTotalMs },
  ];
  const maxPart = Math.max(1, ...parts.map(p => p.value));

  return {
    bits, rate, txPerHop_ms, dTransTotalMs, dPropMs, dProcTotalMs, dQueueTotalMs, totalMs,
    queuePerHop_ms: queuePerHop_ms,
    parts, maxPart,
  };
}
const LS_KEY = "ndv_scenarios_v2";

function loadScenarios() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch {}
  return [];
}
function saveScenarios(arr) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {}
}

function encodeState(sA, sB) {
  const data = { A: sA, B: sB };
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}
function decodeState(str) {
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(str))));
    if (obj && typeof obj === "object") return obj;
  } catch {}
  return null;
}

export default function DelayVisualizer() {
  const [A, setA] = useState({ ...DEFAULT_SCENARIO, name: "A" });
  const [B, setB] = useState({ ...DEFAULT_SCENARIO, name: "B (compare)" });
  const [compare, setCompare] = useState(false);

  const [activeTab, setActiveTab] = useState("overview"); 
  const [scenarios, setScenarios] = useState(loadScenarios());
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const encoded = url.searchParams.get("s");
    if (encoded) {
      const obj = decodeState(encoded);
      if (obj?.A) setA(v => ({ ...v, ...obj.A }));
      if (obj?.B) { setB(v => ({ ...v, ...obj.B })); setCompare(true); setActiveTab("compare"); }
    }
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.target && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "?") { setActiveTab("help"); e.preventDefault(); }
      if (e.key.toLowerCase() === "c") { setCompare(v => !v); setActiveTab(v => (v === "compare" ? "overview" : "compare")); }
      if (e.key.toLowerCase() === "r") { setA({ ...DEFAULT_SCENARIO, name: "A" }); setB({ ...DEFAULT_SCENARIO, name: "B (compare)" }); setToastMsg("Reset ✔"); }
      if (e.key.toLowerCase() === "s") { shareURL(); }
      const names = Object.keys(PRESETS);
      if (/^[1-5]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const p = PRESETS[names[idx]];
        if (p) setA(a => ({ ...a, ...p }));
        setToastMsg(`Preset → ${names[idx]}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function setToastMsg(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }

  function applyPresetTo(sideSetter, name) {
    const p = PRESETS[name];
    if (!p) return;
    sideSetter(s => ({ ...s, ...p }));
    setToastMsg(`Preset → ${name}`);
  }

  function shareURL() {
    const url = new URL(window.location.href);
    url.searchParams.set("s", encodeState(A, compare ? B : null));
    const str = url.toString();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(str).then(() => setToastMsg("Share URL copied"));
    } else {
      prompt("Copy this URL:", str);
    }
  }

  const mA = useMemo(() => computeMetrics(A), [A]);
  const mB = useMemo(() => computeMetrics(B), [B]);
  const diff = useMemo(() => {
    if (!compare) return null;
    return {
      totalMs: mB.totalMs - mA.totalMs,
      tx: mB.dTransTotalMs - mA.dTransTotalMs,
      prop: mB.dPropMs - mA.dPropMs,
      proc: mB.dProcTotalMs - mA.dProcTotalMs,
      queue: mB.dQueueTotalMs - mA.dQueueTotalMs,
    };
  }, [compare, mA, mB]);

  return (
    <div className="ndv-root ndv-alt">
      <div className="ndv-container ndv-shell">
        {}
        <header className="ndv-header ndv-toolbar">
          <div className="ndv-title">Network Delay Visualizer — Pro</div>
          <div className="ndv-toolbar-actions" role="toolbar" aria-label="Global actions">
            <button className="ndv-btn ndv-btn--ghost" onClick={() => { setA({ ...DEFAULT_SCENARIO, name: "A" }); setB({ ...DEFAULT_SCENARIO, name: "B (compare)" }); setToastMsg("Reset ✔"); }}>
              Reset
            </button>
            <button className="ndv-btn ndv-btn--ghost" onClick={() => setCompare(v => !v)} aria-pressed={compare}>
              {compare ? "Compare: ON" : "Compare: OFF"}
            </button>
            <button className="ndv-btn" onClick={shareURL}>Share</button>
            <button className="ndv-btn" onClick={() => setActiveTab("help")}>Help ?</button>
          </div>
          <p className="ndv-subtitle">
            Left: scenario manager & inputs. Center: totals, breakdown, and diagram. Right: insights. Press <kbd>C</kbd> to toggle compare, <kbd>S</kbd> to share, <kbd>?</kbd> for help.
          </p>
        </header>

        {}
        <div className="ndv-app">
          {}
          <aside className="ndv-dock" aria-label="Controls">
            <ScenarioManager
              scenarios={scenarios}
              setScenarios={(arr) => { setScenarios(arr); saveScenarios(arr); }}
              loadToA={(obj) => setA(s => ({ ...s, ...obj }))}
              loadToB={(obj) => setB(s => ({ ...s, ...obj }))}
            />

            <section className="ndv-card">
              <h2 className="ndv-h2">Presets</h2>
              <div className="ndv-presets">
                {Object.keys(PRESETS).map((name) => (
                  <button key={name} className="ndv-btn" onClick={() => applyPresetTo(setA, name)}>{name}</button>
                ))}
              </div>
            </section>

            <InputsCard title="Scenario A" s={A} setS={setA} />
            {compare && <InputsCard title="Scenario B" s={B} setS={setB} />}
          </aside>

          {}
          <main className="ndv-canvas" aria-live="polite">
            <section className="ndv-card ndv-totals ndv-totals--sticky">
              <div className="ndv-total">
                <div className="ndv-total-label">Total Delay — A</div>
                <div className="ndv-total-value">{fmtMs(mA.totalMs)}</div>
              </div>
              {compare && (
                <div className="ndv-total">
                  <div className="ndv-total-label">Total Delay — B</div>
                  <div className="ndv-total-value">{fmtMs(mB.totalMs)}</div>
                </div>
              )}
              {compare && (
                <div className="ndv-total ndv-badge">
                  <div className="ndv-total-label">Δ (B − A)</div>
                  <div className="ndv-total-value">{fmtMs(diff.totalMs)}</div>
                </div>
              )}
            </section>

            {}
            <section className="ndv-card">
              <TabBar active={activeTab} setActive={setActiveTab} tabs={[
                { id: "overview", label: "Overview" },
                { id: "compare", label: "Compare" },
                { id: "diagram", label: "Path Diagram" },
                { id: "help", label: "Help" },
              ]}/>
              {activeTab === "overview" && (
                <Overview m={mA} />
              )}
              {activeTab === "compare" && (
                <ComparePanel mA={mA} mB={mB} diff={diff} compare={compare} />
              )}
              {activeTab === "diagram" && (
                <DiagramPanel A={A} mA={mA} B={B} mB={mB} compare={compare} />
              )}
              {activeTab === "help" && (
                <HelpPanel />
              )}
            </section>

            <section className="ndv-card">
              <h2 className="ndv-h2">How the math works</h2>
              <ul className="ndv-list">
                <li><strong>Transmission (per hop)</strong>: <code>L / R</code> with <code>L</code> in bits and <code>R</code> in bits/s.</li>
                <li><strong>Propagation (total)</strong>: <code>distance / speed</code> (fiber/coax ≈ 2×10<sup>8</sup> m/s, RF ≈ 3×10<sup>8</sup> m/s).</li>
                <li><strong>Processing & Queuing</strong>: added at each hop; totals scale with hop count.</li>
                <li><strong>M/M/1 queue (optional)</strong>: average wait <code>W<sub>q</sub> = ρ / (μ − λ)</code> where <code>μ</code> is service rate in packets/s and <code>λ = ρμ</code>. Service time is your transmission time.</li>
              </ul>
            </section>
          </main>

          {}
          <aside className="ndv-side" aria-label="Insights">
            <section className="ndv-card ndv-sticky">
              <h2 className="ndv-h2">Quick Facts</h2>
              <ul className="ndv-list">
                <li>Fiber ≈ 2.0×10⁸ m/s</li>
                <li>Copper/Coax/Twisted Pair ≈ 2.0×10⁸ m/s</li>
                <li>RF (air) ≈ 3.0×10⁸ m/s</li>
                <li>Store-and-forward: pay <em>transmission</em> at each hop.</li>
              </ul>
            </section>

            <section className="ndv-card">
              <h2 className="ndv-h2">What to Try</h2>
              <ul className="ndv-list">
                <li>Large L + slow R → transmission dominates.</li>
                <li>Long distance → propagation dominates.</li>
                <li>High ρ near 1.0 → queueing explodes (MM1).</li>
                <li>Reduce hops → linear cut to proc & queue.</li>
              </ul>
            </section>

            <section className="ndv-card">
              <h2 className="ndv-h2">Tips</h2>
              <ul className="ndv-list">
                <li>Press <kbd>1–5</kbd> to apply presets to A.</li>
                <li><kbd>C</kbd> toggle compare, <kbd>S</kbd> share, <kbd>R</kbd> reset, <kbd>?</kbd> help.</li>
              </ul>
            </section>
          </aside>
        </div>

        <footer className="ndv-footer">
          Built for mastery — explore, compare, and explain.
        </footer>
      </div>

      {}
      {toast && (
        <div className="ndv-toast">{toast}</div>
      )}
    </div>
  );
}

function TabBar({ active, setActive, tabs }) {
  return (
    <div className="ndv-tabs" role="tablist" aria-label="Views">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`ndv-chip ${active === t.id ? "ndv-chip--on" : ""}`}
          onClick={() => setActive(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function InputsCard({ title, s, setS }) {
  return (
    <section className="ndv-card">
      <h2 className="ndv-h2">{title}</h2>

      <LabeledRange
        label={`Packet size: ${s.packetKB.toFixed(3)} KB`}
        min={0.064} max={128} step={0.016}
        value={s.packetKB}
        onChange={(v) => setS(x => ({ ...x, packetKB: v }))}
      />

      <LabeledRange
        label={`Link rate: ${s.rateMbps} Mb/s`}
        min={1} max={100000} step={1}
        value={s.rateMbps}
        onChange={(v) => setS(x => ({ ...x, rateMbps: Math.round(v) }))}
      />

      <div className="ndv-row">
        <label className="ndv-number" style={{ margin: 0 }}>
          <span className="ndv-number-label">Medium</span>
          <select
            className="ndv-select"
            value={s.medium}
            onChange={(e) => setS(x => ({ ...x, medium: e.target.value }))}
          >
            {Object.keys(PROP_SPEEDS).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>

        <LabeledNumber
          label="Distance (km)"
          value={s.distanceKm}
          onChange={(v) => setS(x => ({ ...x, distanceKm: clamp(v, 0, 40000) }))}
          min={0} max={40000}
        />
      </div>

      <div className="ndv-row">
        <LabeledNumber
          label="Hops"
          value={s.hops}
          onChange={(v) => setS(x => ({ ...x, hops: Math.round(clamp(v, 1, 60)) }))}
          min={1} max={60}
        />
        <LabeledNumber
          label="Processing per hop (µs)"
          value={s.procUsPerHop}
          onChange={(v) => setS(x => ({ ...x, procUsPerHop: clamp(v, 0, 10000) }))}
          min={0} max={10000}
        />
      </div>

      <div className="ndv-field">
        <div className="ndv-field-head">
          <div className="ndv-label">Queue model</div>
          <div className="ndv-range-meta">{s.queueModel === "MM1" ? `M/M/1 (ρ=${s.utilization.toFixed(2)})` : "Fixed per-hop (ms)"}</div>
        </div>
        <div className="ndv-cols">
          <div className="ndv-chip-group">
            <button className={`ndv-chip ${s.queueModel === "Fixed" ? "ndv-chip--on": ""}`} onClick={() => setS(x => ({ ...x, queueModel: "Fixed" }))}>Fixed</button>
            <button className={`ndv-chip ${s.queueModel === "MM1" ? "ndv-chip--on": ""}`} onClick={() => setS(x => ({ ...x, queueModel: "MM1" }))}>M/M/1</button>
          </div>

          {s.queueModel === "Fixed" ? (
            <LabeledNumber
              label="Queuing per hop (ms)"
              value={s.queueMsPerHop}
              onChange={(v) => setS(x => ({ ...x, queueMsPerHop: clamp(v, 0, 200) }))}
              min={0} max={200}
            />
          ) : (
            <LabeledRange
              label={`Utilization ρ: ${(s.utilization * 100).toFixed(0)}%`}
              min={0} max={0.98} step={0.01}
              value={s.utilization}
              onChange={(v) => setS(x => ({ ...x, utilization: clamp(v, 0, 0.98) }))}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function Overview({ m }) {
  return (
    <div className="ndv-stack">
      <div className="ndv-cols">
        <div className="ndv-kvlist">
          <KV label="Packet size (bits)" value={m.bits.toLocaleString()} />
          <KV label="Link rate (bps)" value={m.rate.toLocaleString()} />
          <KV label="Transmission (per hop)" value={fmtMs(m.txPerHop_ms)} />
          <KV label="Propagation (total)" value={fmtMs(m.dPropMs)} />
          <KV label="Processing (all hops)" value={fmtMs(m.dProcTotalMs)} />
          <KV label="Queuing (per hop)" value={fmtMs(m.queuePerHop_ms)} />
          <KV label="Queuing (all hops)" value={fmtMs(m.dQueueTotalMs)} />
        </div>

        <div className="ndv-totals">
          <div className="ndv-total">
            <div className="ndv-total-label">Total end-to-end delay</div>
            <div className="ndv-total-value">{fmtMs(m.totalMs)}</div>
          </div>

          <Bars parts={m.parts} maxPart={m.maxPart} />
        </div>
      </div>
    </div>
  );
}

function ComparePanel({ mA, mB, diff, compare }) {
  if (!compare) return <div className="ndv-range-meta">Turn on Compare to see side-by-side analysis.</div>;
  return (
    <div className="ndv-scenario-grid">
      <div>
        <h3 className="ndv-h3">Scenario A</h3>
        <Bars parts={mA.parts} maxPart={Math.max(mA.maxPart, mB.maxPart)} />
        <ul className="ndv-list" style={{ marginTop: 12 }}>
          <li>Total: {fmtMs(mA.totalMs)}</li>
          <li>Tx: {fmtMs(mA.dTransTotalMs)}</li>
          <li>Prop: {fmtMs(mA.dPropMs)}</li>
          <li>Proc: {fmtMs(mA.dProcTotalMs)}</li>
          <li>Queue: {fmtMs(mA.dQueueTotalMs)}</li>
        </ul>
      </div>

      <div>
        <h3 className="ndv-h3">Scenario B</h3>
        <Bars parts={mB.parts} maxPart={Math.max(mA.maxPart, mB.maxPart)} />
        <ul className="ndv-list" style={{ marginTop: 12 }}>
          <li>Total: {fmtMs(mB.totalMs)}</li>
          <li>Tx: {fmtMs(mB.dTransTotalMs)}</li>
          <li>Prop: {fmtMs(mB.dPropMs)}</li>
          <li>Proc: {fmtMs(mB.dProcTotalMs)}</li>
          <li>Queue: {fmtMs(mB.dQueueTotalMs)}</li>
        </ul>
      </div>

      <div>
        <h3 className="ndv-h3">Δ (B − A)</h3>
        <div className="ndv-bars">
          <DiffBar label="Total" value={diff.totalMs}/>
          <DiffBar label="Transmission" value={diff.tx}/>
          <DiffBar label="Propagation" value={diff.prop}/>
          <DiffBar label="Processing" value={diff.proc}/>
          <DiffBar label="Queuing" value={diff.queue}/>
        </div>
      </div>
    </div>
  );
}

function DiagramPanel({ A, mA, B, mB, compare }) {
  return (
    <div className="ndv-stack">
      <PathDiagram label="A" hops={A.hops} txPerHop_ms={mA.txPerHop_ms} queuePerHop_ms={mA.queuePerHop_ms}/>
      {compare && (
        <PathDiagram label="B" hops={B.hops} txPerHop_ms={mB.txPerHop_ms} queuePerHop_ms={mB.queuePerHop_ms}/>
      )}
      <ul className="ndv-list">
        <li>Each hop adds <em>transmission</em>, <em>processing</em>, and <em>queueing</em>. Longer links add <em>propagation</em> once.</li>
        <li>Glow width hints queueing per hop; dot spacing is constant for clarity.</li>
      </ul>
    </div>
  );
}

function Bars({ parts, maxPart }) {
  return (
    <div className="ndv-bars">
      {parts.map((p) => {
        const pct = (p.value / maxPart) * 100;
        return (
          <div key={p.key} className="ndv-bar-block">
            <div className="ndv-bar-label">{p.label}: {fmtMs(p.value)}</div>
            <div className="ndv-bar-rail" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={+pct.toFixed(1)}>
              <motion.div
                className="ndv-bar-fill"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 140, damping: 20 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiffBar({ label, value }) {
  const mag = Math.min(100, Math.abs(value) / Math.max(1, Math.abs(value)) * 100); // normalized visual
  const sign = value === 0 ? 0 : value > 0 ? 1 : -1;
  return (
    <div className="ndv-bar-block">
      <div className="ndv-bar-label">{label}: {fmtMs(value)} {sign > 0 ? "↑" : sign < 0 ? "↓" : ""}</div>
      <div className="ndv-bar-rail ndv-bar-rail--diff">
        <motion.div
          className={`ndv-bar-fill ${sign >= 0 ? "ndv-bar-fill--pos" : "ndv-bar-fill--neg"}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.abs(value))}%` }}
          transition={{ type: "spring", stiffness: 140, damping: 20 }}
        />
      </div>
    </div>
  );
}

function PathDiagram({ label, hops, txPerHop_ms, queuePerHop_ms }) {
  const nodes = new Array(Math.max(2, Math.min(hops + 1, 30))).fill(0);
  const qGlow = Math.min(24, 4 + (queuePerHop_ms / 2)); // visual hint
  return (
    <div className="ndv-card">
      <h2 className="ndv-h2">Path Diagram — {label}</h2>
      <div className="ndv-path">
        {nodes.map((_, i) => (
          <div key={i} className="ndv-path-node">
            <div className="ndv-path-dot" style={{ boxShadow: `0 0 ${qGlow}px rgba(183,92,255,0.45)` }}/>
            {i < nodes.length - 1 && (
              <div className="ndv-path-link">
                <motion.div
                  className="ndv-path-flow"
                  initial={{ left: 0 }}
                  animate={{ left: "100%" }}
                  transition={{ repeat: Infinity, duration: Math.max(0.4, txPerHop_ms / 50), ease: "linear" }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="ndv-kvlist" style={{ marginTop: 10 }}>
        <KV label="Tx per hop" value={fmtMs(txPerHop_ms)} />
        <KV label="Queue per hop" value={fmtMs(queuePerHop_ms)} />
        <KV label="Hop count (nodes shown = hops+1, capped at 30)" value={hops} />
      </div>
    </div>
  );
}

function ScenarioManager({ scenarios, setScenarios, loadToA, loadToB }) {
  const [name, setName] = useState("");

  function save(side) {
    const s = side();
    const entry = { ...s, savedAt: Date.now() };
    const arr = [entry, ...scenarios].slice(0, 50);
    setScenarios(arr);
  }
  function sideA() { return window.__ndv_getA?.() || {}; }
  function sideB() { return window.__ndv_getB?.() || {}; }
  useEffect(() => {
    return () => {
      delete window.__ndv_getA;
      delete window.__ndv_getB;
    };
  }, []);

  return (
    <section className="ndv-card">
      <h2 className="ndv-h2">Scenario Manager</h2>
      <div className="ndv-stack">
        <div className="ndv-row">
          <input className="ndv-input" placeholder="Name (optional)" value={name} onChange={e=>setName(e.target.value)} />
          <div className="ndv-chip-group">
            <button
              className="ndv-chip"
              onClick={() => {
                const a = window.__ndv_currentA;
                if (!a) return;
                const entry = { ...a, name: name || a.name, savedAt: Date.now() };
                const arr = [entry, ...scenarios].slice(0, 50);
                setScenarios(arr);
              }}
            >Save A</button>
            <button
              className="ndv-chip"
              onClick={() => {
                const b = window.__ndv_currentB;
                if (!b) return;
                const entry = { ...b, name: name || b.name, savedAt: Date.now() };
                const arr = [entry, ...scenarios].slice(0, 50);
                setScenarios(arr);
              }}
            >Save B</button>
          </div>
        </div>

        {scenarios.length === 0 ? (
          <div className="ndv-range-meta">No saved scenarios yet. Tweak inputs, then “Save A” or “Save B”.</div>
        ) : (
          <div className="ndv-saved-list">
            {scenarios.map((sc, i) => (
              <div key={i} className="ndv-saved-row">
                <div className="ndv-saved-meta">
                  <div className="ndv-saved-name">{sc.name || `Saved #${i+1}`}</div>
                  <div className="ndv-range-meta">{new Date(sc.savedAt).toLocaleString()}</div>
                </div>
                <div className="ndv-chip-group">
                  <button className="ndv-chip" onClick={() => loadToA(sc)}>Load → A</button>
                  <button className="ndv-chip" onClick={() => loadToB(sc)}>Load → B</button>
                  <button className="ndv-chip" onClick={() => {
                    const newName = prompt("Rename scenario:", sc.name || "");
                    if (newName != null) {
                      const arr = scenarios.slice();
                      arr[i] = { ...arr[i], name: newName };
                      setScenarios(arr);
                    }
                  }}>Rename</button>
                  <button className="ndv-chip" onClick={() => {
                    const arr = scenarios.slice(); arr.splice(i,1); setScenarios(arr);
                  }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function LabeledRange({ label, value, onChange, min, max, step }) {
  return (
    <div className="ndv-field">
      <div className="ndv-field-head">
        <div className="ndv-label">{label}</div>
        <div className="ndv-range-meta">[{min}–{max}]</div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="ndv-range"
      />
    </div>
  );
}

function LabeledNumber({ label, value, onChange, min, max }) {
  return (
    <label className="ndv-number">
      <span className="ndv-number-label">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="ndv-input"
      />
    </label>
  );
}

function KV({ label, value }) {
  return (
    <div className="ndv-kv">
      <div className="ndv-kv-label">{label}</div>
      <div className="ndv-kv-value">{value}</div>
    </div>
  );
}

(function mountGlobalRefs() {

})();
