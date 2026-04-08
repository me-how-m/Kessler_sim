import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const R_EARTH = 6371, LEO_MIN = 400, LEO_MAX = 2000, MEO_ALT = 20200, GEO_ALT = 35786;
const MAX_DOTS = 1500, SIM_YEAR = 12;

function altV(alt) {
  if (alt <= LEO_MAX) return 62 + (alt - LEO_MIN) / (LEO_MAX - LEO_MIN) * 28;
  if (alt <= MEO_ALT) return 90 + (alt - LEO_MAX) / (MEO_ALT - LEO_MAX) * 40;
  return 130 + (alt - MEO_ALT) / (GEO_ALT - MEO_ALT) * 45;
}

function mk(type, altKm) {
  const alt = altKm || (type === "g" ? GEO_ALT + (Math.random() - .5) * 200 : type === "m" ? MEO_ALT + (Math.random() - .5) * 2000 : LEO_MIN + Math.random() * (LEO_MAX - LEO_MIN));
  const r = altV(alt), incl = type === "g" ? (Math.random() - .5) * .1 : (Math.random() - .5) * Math.PI * .85;
  const spd = (2 * Math.PI / (2 * Math.PI * Math.sqrt(((R_EARTH + alt) * 1000) ** 3 / 3.986e14))) * 4000;
  return { type, r, alt, incl, raan: Math.random() * Math.PI * 2, phase: Math.random() * Math.PI * 2, speed: spd, alive: true };
}

function p3(o) {
  const cp = Math.cos(o.phase), sp = Math.sin(o.phase), cr = Math.cos(o.raan), sr = Math.sin(o.raan), ci = Math.cos(o.incl), si = Math.sin(o.incl);
  return [o.r * (cp * cr - sp * sr * ci), o.r * (cp * sr + sp * cr * ci), o.r * sp * si];
}

const INFO = {
  year: { desc: "Current simulation year. At 1× speed, 1 year ≈ 12 real seconds." },
  sats: { desc: "Operational satellites. Retire at ~8%/yr; non-compliant retirees become debris." },
  debris: { desc: "Each dot ≈ 50 real trackable fragments ≥10 cm. Collision probability ∝ density²." },
  collisions: { desc: "Cumulative collisions. Each destroys 2 objects and creates configurable fragments." },
  fragRate: { desc: "Collisions in last 15 sim-years. Above 8 = critical, 20+ = runaway." },
  launches: { desc: "Satellites deployed/year. Multiple can launch per frame at high rates." },
  compliance: { desc: "% of retired sats that safely deorbit. Rest become debris." },
  removal: { desc: "Missions/year removing 1 debris dot each (~50 real fragments)." },
  cleanups: { desc: "Bulk cleanup ops/year. Each removes debris = efficiency setting." },
  efficiency: { desc: "Debris dots removed per cleanup operation." },
  fragments: { desc: "Debris dots per collision (each ≈ 50 real pieces). At 40 dots = ~2000 real fragments (Iridium-Cosmos scale). At 200 = catastrophic hypervelocity event." },
  speed: { desc: "Time multiplier. At 10× one year passes in ~1.2 seconds." },
};

export default function App() {
  const cvs = useRef(null), simRef = useRef(null), rafRef = useRef(null), starsRef = useRef(null), fcRef = useRef(0), zoomRef = useRef(1);
  const cfgRef = useRef({ launches: 2400, compliance: 80, speed: 0.4, cleanups: 0, efficiency: 0, fragments: 40 });
  const runRef = useRef(true);
  const histRef = useRef([]);

  const [cfg, _setCfg] = useState(cfgRef.current);
  const [run, _setRun] = useState(true);
  const [st, setSt] = useState({ year: 2026, sats: 0, debris: 0, collisions: 0, fragRate: 0, cascade: 0 });
  const [tooltip, setTooltip] = useState(null);
  const [hist, setHist] = useState([]);

  const setCfg = fn => { _setCfg(prev => { const next = typeof fn === "function" ? fn(prev) : fn; cfgRef.current = next; return next; }); };
  const setRun = v => { const nv = typeof v === "function" ? v(runRef.current) : v; runRef.current = nv; _setRun(nv); };
  const set = (k, v) => setCfg(p => ({ ...p, [k]: v }));

  const init = useCallback(() => {
    const objs = [];
    for (let i = 0; i < 80; i++) objs.push(mk("l"));
    for (let i = 0; i < 20; i++) objs.push(mk("m"));
    for (let i = 0; i < 15; i++) objs.push(mk("g"));
    for (let i = 0; i < 30; i++) objs.push(mk("d"));
    simRef.current = { objs, t: 0, cols: 0, recentCols: [], lastClean: 0, flashes: [], launchAccum: 0 };
    histRef.current = [{ y: 2026, s: 115, d: 30, c: 0 }, { y: 2026, s: 115, d: 30, c: 0 }];
    setHist(histRef.current);
    setSt({ year: 2026, sats: 115, debris: 30, collisions: 0, fragRate: 0, cascade: 0 });
  }, []);

  useEffect(() => { init(); }, [init]);

  const collide = (s, a, b, cc) => {
    a.alive = false; b.alive = false;
    s.cols++; s.recentCols.push(s.t);
    const pos = p3(a);
    const aliveN = s.objs.reduce((c2, o) => c2 + (o.alive ? 1 : 0), 0);
    const nd = Math.min(cc.fragments + Math.floor(Math.random() * 4), MAX_DOTS - aliveN);
    const baseAlt = a.alt || (LEO_MIN + Math.random() * (LEO_MAX - LEO_MIN));
    for (let k = 0; k < Math.max(0, nd); k++) {
      const dd = mk("d", baseAlt + (Math.random() - .5) * 500);
      dd.phase = a.phase + (Math.random() - .5) * .6; dd.speed *= (.4 + Math.random() * 1.2);
      s.objs.push(dd);
    }
    s.flashes.push({ pos, time: s.t });
  };

  const doASAT = () => {
    const s = simRef.current; if (!s) return;
    const tgts = s.objs.filter(o => o.alive && o.type !== "d");
    if (!tgts.length) return;
    const t = tgts[Math.floor(Math.random() * tgts.length)];
    t.alive = false;
    const pos = p3(t);
    const aliveN = s.objs.reduce((c2, o) => c2 + (o.alive ? 1 : 0), 0);
    const n = Math.min(cfgRef.current.fragments + 10, MAX_DOTS - aliveN);
    for (let i = 0; i < Math.max(0, n); i++) {
      const d = mk("d", t.alt + (Math.random() - .5) * 600);
      d.phase = t.phase + (Math.random() - .5) * .8; d.speed *= (.4 + Math.random() * 1.2);
      s.objs.push(d);
    }
    s.cols++; s.recentCols.push(s.t); s.flashes.push({ pos, time: s.t });
  };

  useEffect(() => {
    const c = cvs.current; if (!c) return;
    const ctx = c.getContext("2d");
    let rot = 0, tilt = .35, dragging = false, mx2 = 0, my2 = 0;
    let lastHistT = 0;

    const resize = () => {
      const p = c.parentElement; c.width = p.clientWidth; c.height = p.clientHeight;
      const sc = document.createElement("canvas"); sc.width = c.width; sc.height = c.height;
      const sctx = sc.getContext("2d");
      sctx.fillStyle = "#111318"; sctx.fillRect(0, 0, sc.width, sc.height);
      for (let i = 0; i < 50; i++) { sctx.beginPath(); sctx.arc(Math.random() * sc.width, Math.random() * sc.height, Math.random() * .7, 0, Math.PI * 2); sctx.fillStyle = `rgba(200,215,240,${.2 + Math.random() * .35})`; sctx.fill(); }
      starsRef.current = sc;
    };
    resize(); window.addEventListener("resize", resize);

    const onD = e => { dragging = true; const p = e.touches ? e.touches[0] : e; mx2 = p.clientX; my2 = p.clientY; };
    const onM = e => { if (!dragging) return; const p = e.touches ? e.touches[0] : e; rot += (p.clientX - mx2) * .005; tilt = Math.max(-1.2, Math.min(1.2, tilt + (p.clientY - my2) * .005)); mx2 = p.clientX; my2 = p.clientY; };
    const onU = () => { dragging = false; };
    const onWheel = e => { e.preventDefault(); zoomRef.current = Math.max(0.5, Math.min(5, zoomRef.current * (1 - e.deltaY * 0.001))); };
    c.addEventListener("mousedown", onD); c.addEventListener("mousemove", onM); c.addEventListener("mouseup", onU); c.addEventListener("mouseleave", onU);
    c.addEventListener("touchstart", onD, { passive: true }); c.addEventListener("touchmove", onM, { passive: true }); c.addEventListener("touchend", onU);
    c.addEventListener("wheel", onWheel, { passive: false });

    const proj = (x, y, z) => {
      const cr2 = Math.cos(rot), sr2 = Math.sin(rot), ct = Math.cos(tilt), st2 = Math.sin(tilt);
      const nx = x * cr2 - y * sr2, ny = x * sr2 + y * cr2, fy = ny * ct - z * st2, fz = ny * st2 + z * ct;
      const sc = 500 / (500 + fy) * zoomRef.current;
      return { sx: c.width / 2 + nx * sc, sy: c.height / 2 - fz * sc, depth: fy, sc };
    };

    const drawShell = (vr, label, alpha) => {
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2; a += .12) { const p = proj(vr * Math.cos(a), vr * Math.sin(a), 0); a === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy); }
      ctx.closePath(); ctx.strokeStyle = `rgba(100,140,200,${alpha})`; ctx.lineWidth = .5; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
      if (label) { const lp = proj(vr * 1.02, 0, 0); ctx.font = "9px system-ui"; ctx.fillStyle = `rgba(140,170,220,${alpha + .15})`; ctx.fillText(label, lp.sx + 3, lp.sy - 3); }
    };

    const loop = () => {
      const s = simRef.current; if (!s) { rafRef.current = requestAnimationFrame(loop); return; }
      const W = c.width, H = c.height, cc = cfgRef.current, isRun = runRef.current;
      fcRef.current++;

      if (starsRef.current) ctx.drawImage(starsRef.current, 0, 0);
      else { ctx.fillStyle = "#111318"; ctx.fillRect(0, 0, W, H); }

      drawShell(altV(LEO_MIN), "LEO 400km", .15);
      drawShell(altV(LEO_MAX), "2000km", .12);
      drawShell(altV(MEO_ALT), "MEO", .1);
      drawShell(altV(GEO_ALT), "GEO", .12);

      const ec = proj(0, 0, 0), eR = 60 * zoomRef.current;
      const eg = ctx.createRadialGradient(ec.sx - eR * .25, ec.sy - eR * .25, eR * .05, ec.sx, ec.sy, eR);
      eg.addColorStop(0, "#4aaef0"); eg.addColorStop(.35, "#1e6ab0"); eg.addColorStop(.7, "#0e3a6c"); eg.addColorStop(1, "#071c38");
      ctx.beginPath(); ctx.arc(ec.sx, ec.sy, eR, 0, Math.PI * 2); ctx.fillStyle = eg; ctx.fill();
      const ag = ctx.createRadialGradient(ec.sx, ec.sy, eR * .96, ec.sx, ec.sy, eR * 1.08);
      ag.addColorStop(0, "rgba(80,170,255,.12)"); ag.addColorStop(1, "rgba(80,170,255,0)");
      ctx.beginPath(); ctx.arc(ec.sx, ec.sy, eR * 1.08, 0, Math.PI * 2); ctx.fillStyle = ag; ctx.fill();

      if (isRun) {
        const dt = .016 * cc.speed;
        s.t += dt;
        for (let i = 0; i < s.objs.length; i++) { if (s.objs[i].alive) s.objs[i].phase += s.objs[i].speed * dt; }

        // Launches: accumulator handles high rates properly
        const aliveN = s.objs.reduce((c2, o) => c2 + (o.alive ? 1 : 0), 0);
        s.launchAccum += (cc.launches / SIM_YEAR) * dt;
        const toLaunch = Math.floor(s.launchAccum);
        s.launchAccum -= toLaunch;
        for (let i = 0; i < Math.min(toLaunch, MAX_DOTS - aliveN); i++) {
          const tp = Math.random();
          s.objs.push(mk(tp < .7 ? "l" : tp < .9 ? "m" : "g"));
        }

        // Retirement ~8%/year
        const retireRate = (0.08 / SIM_YEAR) * dt;
        for (let i = 0; i < s.objs.length; i++) {
          const o = s.objs[i];
          if (!o.alive || o.type === "d") continue;
          if (Math.random() < retireRate) {
            o.alive = false;
            if (Math.random() * 100 > cc.compliance) {
              const d = mk("d", o.alt + (Math.random() - .5) * 100);
              d.phase = o.phase; s.objs.push(d);
            }
          }
        }

        // Cleanups
        const cInt = cc.cleanups > 0 ? (SIM_YEAR / cc.cleanups) : Infinity;
        if (s.t - s.lastClean > cInt && cc.cleanups > 0) {
          s.lastClean = s.t;
          let rem = 0;
          for (let i = s.objs.length - 1; i >= 0 && rem < cc.efficiency; i--) {
            if (s.objs[i].alive && s.objs[i].type === "d") { s.objs[i].alive = false; rem++; }
          }
        }

        // Collision model
        const alive = [];
        let leoN = 0, meoN = 0;
        for (let i = 0; i < s.objs.length; i++) {
          if (s.objs[i].alive) {
            alive.push(s.objs[i]);
            if (s.objs[i].r < 95) leoN++;
            else if (s.objs[i].r < 135) meoN++;
          }
        }
        const an = alive.length;

        // Geometric proximity
        const geomChecks = Math.min(80, an * (an - 1) / 2);
        for (let ch = 0; ch < geomChecks; ch++) {
          const i = Math.floor(Math.random() * an);
          let j = Math.floor(Math.random() * (an - 1)); if (j >= i) j++;
          const a = alive[i], b = alive[j];
          if (!a.alive || !b.alive || Math.abs(a.r - b.r) > 10) continue;
          const [ax, ay, az] = p3(a), [bx, by, bz] = p3(b);
          if ((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2 < 49) collide(s, a, b, cc);
        }

        // Statistical density² collision model (LEO)
        const leoDensity = leoN / 80;
        const leoColProb = (leoDensity * leoDensity * 0.25 / SIM_YEAR) * dt;
        if (Math.random() < leoColProb && leoN >= 2) {
          const leoObjs = alive.filter(o => o.alive && o.r < 95);
          if (leoObjs.length >= 2) {
            const i = Math.floor(Math.random() * leoObjs.length);
            let j = Math.floor(Math.random() * (leoObjs.length - 1)); if (j >= i) j++;
            if (leoObjs[i].alive && leoObjs[j].alive) collide(s, leoObjs[i], leoObjs[j], cc);
          }
        }

        // MEO statistical
        const meoDensity = meoN / 80;
        const meoProb = (meoDensity * meoDensity * 0.08 / SIM_YEAR) * dt;
        if (Math.random() < meoProb && meoN >= 2) {
          const meoObjs = alive.filter(o => o.alive && o.r >= 95 && o.r < 135);
          if (meoObjs.length >= 2) {
            const i = Math.floor(Math.random() * meoObjs.length);
            let j = Math.floor(Math.random() * (meoObjs.length - 1)); if (j >= i) j++;
            if (meoObjs[i].alive && meoObjs[j].alive) collide(s, meoObjs[i], meoObjs[j], cc);
          }
        }

        if (fcRef.current % 90 === 0) s.objs = s.objs.filter(o => o.alive);
        s.recentCols = s.recentCols.filter(t2 => s.t - t2 < 5 * SIM_YEAR);

        // Stats + history
        if (fcRef.current % 8 === 0) {
          let sats = 0, deb = 0;
          for (let i = 0; i < s.objs.length; i++) { if (!s.objs[i].alive) continue; s.objs[i].type === "d" ? deb++ : sats++; }
          const rate = s.recentCols.length;
          const year = Math.floor(2026 + s.t / SIM_YEAR);

          // Cascade: consider both collision rate AND debris trend
          const h = histRef.current;
          const debrisGrowing = h.length >= 3 ? deb > h[h.length - 3].d : deb > 30;
          let cascade = 0;
          if (debrisGrowing && rate > 20) cascade = 3;       // RUNAWAY: high rate + debris increasing
          else if (debrisGrowing && rate > 6) cascade = 2;   // Critical: moderate rate + growing
          else if (rate > 3) cascade = 1;                     // Building: some collisions happening
          else cascade = 0;                                   // Stable

          setSt({ year, sats, debris: deb, collisions: s.cols, fragRate: rate, cascade });

          const histInterval = SIM_YEAR * 0.5;
          if (s.t - lastHistT >= histInterval) {
            lastHistT = s.t;
            const entry = { y: year, s: sats, d: deb, c: s.cols };
            histRef.current = [...histRef.current.slice(-80), entry];
            setHist([...histRef.current]);
          }
        }
      }

      // Render objects
      const projected = [];
      for (let i = 0; i < s.objs.length; i++) {
        const o = s.objs[i]; if (!o.alive) continue;
        const [x, y, z] = p3(o), p = proj(x, y, z);
        projected.push({ t: o.type, sx: p.sx, sy: p.sy, d: p.depth, sc: p.sc });
      }
      projected.sort((a, b) => b.d - a.d);

      for (let i = 0; i < projected.length; i++) {
        const o = projected[i], behind = o.d > 0, a = behind ? .18 : .85;
        if (o.t === "d") {
          const sz = Math.max(1, 1.6 * o.sc);
          ctx.fillStyle = `rgba(230,150,60,${a})`; ctx.fillRect(o.sx - sz, o.sy - sz, sz * 2, sz * 2);
        } else {
          const sz = Math.max(1.5, 2.8 * o.sc);
          ctx.fillStyle = o.t === "g" ? `rgba(140,200,255,${a})` : o.t === "m" ? `rgba(80,180,255,${a})` : `rgba(50,200,255,${a})`;
          ctx.beginPath(); ctx.arc(o.sx, o.sy, sz, 0, Math.PI * 2); ctx.fill();
        }
      }

      s.flashes = s.flashes.filter(f => s.t - f.time < 1.5);
      for (let i = 0; i < s.flashes.length; i++) {
        const f = s.flashes[i], age = s.t - f.time, p = proj(f.pos[0], f.pos[1], f.pos[2]);
        const r2 = 4 + age * 20, al = Math.max(0, 1 - age / 1.5);
        ctx.beginPath(); ctx.arc(p.sx, p.sy, r2, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,80,30,${al * .6})`; ctx.fill();
      }

      if (!dragging) rot += .0015 * cc.speed;
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); c.removeEventListener("mousedown", onD); c.removeEventListener("mousemove", onM); c.removeEventListener("mouseup", onU); c.removeEventListener("mouseleave", onU); c.removeEventListener("touchstart", onD); c.removeEventListener("touchmove", onM); c.removeEventListener("touchend", onU); c.removeEventListener("wheel", onWheel); };
  }, []);

  const cascL = ["Stable", "Building", "Critical", "RUNAWAY"], cascC = ["#3dbd72", "#d4a824", "#e06030", "#e02020"];

  const MiniChart = ({ data, dataKey, color, label }) => (
    <div style={{ width: 110, minWidth: 0 }}>
      <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <ResponsiveContainer width="100%" height={48}>
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <YAxis hide domain={["auto", "auto"]} />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Tooltip
            contentStyle={{ background: "#222", border: "none", borderRadius: 6, fontSize: 11, padding: "4px 8px" }}
            labelFormatter={v => `Year ${v}`}
            formatter={v => [v, label]}
            itemStyle={{ color }}
            labelStyle={{ color: "#aaa" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  const Sl = ({ id, label, val, onChange, min, max, step, fmt }) => (
    <div style={{ margin: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#c8c0b8", marginBottom: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {label}
          <span onClick={() => setTooltip(tooltip === id ? null : id)} style={{ cursor: "pointer", fontSize: 10, color: "#666", border: "1px solid #555", borderRadius: "50%", width: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>?</span>
        </span>
        <span style={{ fontWeight: 600, color: "#e8e0d8", fontSize: 12, textAlign: "right", maxWidth: 150 }}>{fmt ? fmt(val) : val}</span>
      </div>
      {tooltip === id && <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5, padding: "4px 8px 6px", background: "rgba(255,255,255,.04)", borderRadius: 6, marginBottom: 3 }}>{INFO[id].desc}</div>}
      <input type="range" min={min} max={max} step={step || 1} value={val} onChange={e => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: "#888", height: 3, cursor: "pointer" }} />
    </div>
  );

  const Card = ({ id, label, value, color }) => (
    <div onClick={() => setTooltip(tooltip === id ? null : id)} style={{ background: "#f5f0e8", borderRadius: 8, padding: "8px 12px", flex: 1, minWidth: 0, cursor: "pointer", position: "relative" }}>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 1, display: "flex", alignItems: "center", gap: 3 }}>{label} <span style={{ fontSize: 8, color: "#aaa" }}>ⓘ</span></div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "#222", fontFamily: "system-ui" }}>{value}</div>
      {tooltip === id && <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 10, fontSize: 11, color: "#ccc", lineHeight: 1.5, padding: "6px 10px", background: "#2a2a30", borderRadius: 6, marginTop: 4, boxShadow: "0 4px 12px rgba(0,0,0,.5)" }}>{INFO[id].desc}</div>}
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100vh", background: "#1a1a1e", display: "flex", fontFamily: "system-ui,sans-serif", overflow: "hidden" }}>
      <div style={{ flex: 1, position: "relative", background: "#111318", borderRadius: 12, margin: 10, overflow: "hidden" }}>
        <canvas ref={cvs} style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }} />
        <div style={{ position: "absolute", bottom: 14, left: 14, fontSize: 11, color: "rgba(180,190,210,.45)", fontFamily: "system-ui", letterSpacing: .3, lineHeight: 1.4 }}>
          Michal Monit, PhD&nbsp;&nbsp;&nbsp;&nbsp;#exponentialmath
        </div>
        <div style={{ position: "absolute", top: 12, right: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <button onClick={() => { zoomRef.current = Math.min(5, zoomRef.current * 1.3); }} style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid rgba(100,140,200,.3)", background: "rgba(10,12,20,.85)", color: "#c8d4e8", fontSize: 18, cursor: "pointer", backdropFilter: "blur(8px)", fontWeight: 300 }}>+</button>
          <button onClick={() => { zoomRef.current = Math.max(0.5, zoomRef.current / 1.3); }} style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid rgba(100,140,200,.3)", background: "rgba(10,12,20,.85)", color: "#c8d4e8", fontSize: 18, cursor: "pointer", backdropFilter: "blur(8px)", fontWeight: 300 }}>−</button>
          <button onClick={() => { zoomRef.current = 1; }} style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid rgba(100,140,200,.3)", background: "rgba(10,12,20,.85)", color: "#c8d4e8", fontSize: 10, cursor: "pointer", backdropFilter: "blur(8px)" }}>1:1</button>
        </div>
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6, background: "rgba(10,12,20,.85)", borderRadius: 10, padding: "8px 10px 4px", backdropFilter: "blur(8px)", border: "1px solid rgba(100,140,200,.15)" }}>
          <MiniChart data={hist} dataKey="s" color="#3399ff" label="Satellites" />
          <MiniChart data={hist} dataKey="d" color="#e69640" label="Debris" />
          <MiniChart data={hist} dataKey="c" color="#e05050" label="Collisions" />
        </div>
      </div>
      <div style={{ width: 320, padding: "12px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 0, color: "#e0dcd4" }}>
        <Card id="year" label="Year" value={st.year} />
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Card id="sats" label="Active sats" value={st.sats.toLocaleString()} color="#1a6ab0" />
          <Card id="debris" label="Debris (×50)" value={st.debris.toLocaleString()} color="#c87830" />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <Card id="collisions" label="Collisions" value={st.collisions} />
          <Card id="fragRate" label="Events/window" value={st.fragRate} />
        </div>
        <div style={{ marginTop: 8, padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, textAlign: "center", color: cascC[st.cascade], background: `${cascC[st.cascade]}18`, border: `1px solid ${cascC[st.cascade]}44`, animation: st.cascade >= 3 ? "pulse .5s infinite alternate" : "none" }}>
          Cascade: {cascL[st.cascade]}
        </div>

        <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 12, marginBottom: 1 }}>Space activity</div>
        <Sl id="launches" label="Annual launches" val={cfg.launches} onChange={v => set("launches", v)} min={0} max={6000} step={50} />
        <Sl id="compliance" label="Deorbit compliance" val={cfg.compliance} onChange={v => set("compliance", v)} min={0} max={100} fmt={v => v + "%"} />

        <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 6, marginBottom: 1 }}>Collision physics</div>
        <Sl id="fragments" label="Fragments / collision" val={cfg.fragments} onChange={v => set("fragments", v)} min={2} max={200} fmt={v => `${v} (≈${(v * 50).toLocaleString()} real)`} />

        <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 6, marginBottom: 1 }}>Mitigation</div>
        <Sl id="cleanups" label="Clean-ups / year" val={cfg.cleanups} onChange={v => set("cleanups", v)} min={0} max={24} />
        <Sl id="efficiency" label="Clean-up efficiency" val={cfg.efficiency} onChange={v => set("efficiency", v)} min={0} max={50} fmt={v => v + " debris"} />

        <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 6, marginBottom: 1 }}>Simulation</div>
        <Sl id="speed" label="Speed" val={cfg.speed} onChange={v => set("speed", v)} min={0.1} max={10} step={0.1} fmt={v => v + "×"} />

        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button onClick={() => setRun(p => !p)} style={{ flex: 1, padding: "10px 0", border: "2px solid #c89030", borderRadius: 8, background: "transparent", color: "#e8d8b8", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            {run ? "⏸ Pause" : "▶ Play"}
          </button>
          <button onClick={init} style={{ flex: 1, padding: "10px 0", border: "1px solid #666", borderRadius: 8, background: "transparent", color: "#bbb", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            ↻ Reset
          </button>
        </div>
        <button onClick={doASAT} style={{ marginTop: 6, padding: "10px 0", border: "1px solid #c04040", borderRadius: 8, background: "rgba(200,60,60,.1)", color: "#e06060", cursor: "pointer", fontWeight: 700, fontSize: 13, width: "100%" }}>
          Simulate ASAT test
        </button>

        <div style={{ display: "flex", gap: 14, marginTop: 10, justifyContent: "center", paddingBottom: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#999" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#32c8ff", display: "inline-block" }} /> Satellite</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#999" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#e69640", display: "inline-block" }} /> Debris</span>
        </div>
      </div>
      <style>{`@keyframes pulse{from{opacity:.7}to{opacity:1}}input[type=range]{-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.1);border-radius:2px;outline:none;}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#ddd;cursor:pointer;border:none;box-shadow:0 1px 4px rgba(0,0,0,.4);} div::-webkit-scrollbar{width:4px;} div::-webkit-scrollbar-thumb{background:#444;border-radius:2px;}`}</style>
    </div>
  );
}
