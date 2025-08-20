export type Vec2 = { x: number; y: number };

export interface System {
  f: (x: number, y: number, p: Record<string, number>) => number;
  g: (x: number, y: number, p: Record<string, number>) => number;
  params: Record<string, number>;
}

export function expandedBoundsFromView(T: Transform, factor = 3) {
  const cx = (T.xmin + T.xmax) / 2;
  const cy = (T.ymin + T.ymax) / 2;
  const hw = ((T.xmax - T.xmin) / 2) * factor;
  const hh = ((T.ymax - T.ymin) / 2) * factor;
  return { xmin: cx - hw, xmax: cx + hw, ymin: cy - hh, ymax: cy + hh };
}

export function integrationBoundsFor(T: Transform, seed: Vec2, factor = 3) {
  const b = expandedBoundsFromView(T, factor);
  return {
    xmin: Math.min(b.xmin, seed.x),
    xmax: Math.max(b.xmax, seed.x),
    ymin: Math.min(b.ymin, seed.y),
    ymax: Math.max(b.ymax, seed.y),
  };
}

export function rk4(
  sys: System,
  p0: Vec2,
  dt: number,
  steps: number,
  worldBounds: { xmin: number; xmax: number; ymin: number; ymax: number }
): Vec2[] {
  const pts: Vec2[] = [p0];
  let { x, y } = p0;
  for (let i = 0; i < steps; i++) {
    const { f, g, params } = sys;
    const k1x = f(x, y, params);
    const k1y = g(x, y, params);

    const x2 = x + 0.5 * dt * k1x;
    const y2 = y + 0.5 * dt * k1y;
    const k2x = f(x2, y2, params);
    const k2y = g(x2, y2, params);

    const x3 = x + 0.5 * dt * k2x;
    const y3 = y + 0.5 * dt * k2y;
    const k3x = f(x3, y3, params);
    const k3y = g(x3, y3, params);

    const x4 = x + dt * k3x;
    const y4 = y + dt * k3y;
    const k4x = f(x4, y4, params);
    const k4y = g(x4, y4, params);

    x = x + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    y = y + (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);

    if (
      !isFinite(x) ||
      !isFinite(y) ||
      x < worldBounds.xmin ||
      x > worldBounds.xmax ||
      y < worldBounds.ymin ||
      y > worldBounds.ymax
    )
      break;

    pts.push({ x, y });
  }
  return pts;
}

export function integrateBidirectional(
  sys: System,
  seed: Vec2,
  dt: number,
  steps: number,
  bounds: { xmin: number; xmax: number; ymin: number; ymax: number }
) {
  const forward = rk4(sys, seed, +dt, steps, bounds);
  const backward = rk4(sys, seed, -dt, steps, bounds);
  return { forward, backward };
}

export class Transform {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  constructor(xmin: number, xmax: number, ymin: number, ymax: number) {
    this.xmin = xmin;
    this.xmax = xmax;
    this.ymin = ymin;
    this.ymax = ymax;
  }
  toScreen(w: number, h: number, p: Vec2): Vec2 {
    const sx = ((p.x - this.xmin) / (this.xmax - this.xmin)) * w;
    const sy = h - ((p.y - this.ymin) / (this.ymax - this.ymin)) * h;
    return { x: sx, y: sy };
  }
  toWorld(w: number, h: number, p: Vec2): Vec2 {
    const x = (p.x / w) * (this.xmax - this.xmin) + this.xmin;
    const y = ((h - p.y) / h) * (this.ymax - this.ymin) + this.ymin;
    return { x, y };
  }
  zoom(cx: number, cy: number, factor: number) {
    const xr = this.xmax - this.xmin;
    const yr = this.ymax - this.ymin;
    const nxr = xr / factor;
    const nyr = yr / factor;
    this.xmin = cx - (cx - this.xmin) * (nxr / xr);
    this.xmax = this.xmin + nxr;
    this.ymin = cy - (cy - this.ymin) * (nyr / yr);
    this.ymax = this.ymin + nyr;
  }
  pan(dx: number, dy: number) {
    this.xmin += dx;
    this.xmax += dx;
    this.ymin += dy;
    this.ymax += dy;
  }
}

function niceStep(span: number, targetSteps: number): number {
  const raw = span / targetSteps;
  const pow10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / pow10;
  let niceFrac;
  if (frac < 1.5) niceFrac = 1;
  else if (frac < 3.5) niceFrac = 2;
  else if (frac < 7.5) niceFrac = 5;
  else niceFrac = 10;
  return niceFrac * pow10;
}

export function drawAxes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: Transform,
  showGrid: boolean
) {
  if (!showGrid) return;

  ctx.save();

  const spanX = T.xmax - T.xmin;
  const spanY = T.ymax - T.ymin;
  const stepX = niceStep(spanX, 12);
  const stepY = niceStep(spanY, 12);

  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  const xStart = Math.ceil(T.xmin / stepX) * stepX;
  for (let x = xStart; x <= T.xmax; x += stepX) {
    const p1 = T.toScreen(w, h, { x, y: T.ymin });
    const p2 = T.toScreen(w, h, { x, y: T.ymax });
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  const yStart = Math.ceil(T.ymin / stepY) * stepY;
  for (let y = yStart; y <= T.ymax; y += stepY) {
    const p1 = T.toScreen(w, h, { x: T.xmin, y });
    const p2 = T.toScreen(w, h, { x: T.xmax, y });
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([]);

  const x0a = T.toScreen(w, h, { x: 0, y: T.ymin });
  const x0b = T.toScreen(w, h, { x: 0, y: T.ymax });
  ctx.beginPath();
  ctx.moveTo(x0a.x, x0a.y);
  ctx.lineTo(x0b.x, x0b.y);
  ctx.stroke();

  const y0a = T.toScreen(w, h, { x: T.xmin, y: 0 });
  const y0b = T.toScreen(w, h, { x: T.xmax, y: 0 });
  ctx.beginPath();
  ctx.moveTo(y0a.x, y0a.y);
  ctx.lineTo(y0b.x, y0b.y);
  ctx.stroke();

  ctx.restore();
}

export function drawVectorField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: Transform,
  sys: System,
  density: number = 22
) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#4b8";

  const cols = density;
  const rows = density;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = T.xmin + ((i + 0.5) / cols) * (T.xmax - T.xmin);
      const y = T.ymin + ((j + 0.5) / rows) * (T.ymax - T.ymin);
      const vx = sys.f(x, y, sys.params);
      const vy = sys.g(x, y, sys.params);
      const vlen = Math.hypot(vx, vy) + 1e-9;
      const scale =
        0.35 * Math.min((T.xmax - T.xmin) / cols, (T.ymax - T.ymin) / rows);
      const dx = (vx / vlen) * scale;
      const dy = (vy / vlen) * scale;
      const p = T.toScreen(w, h, { x, y });
      const q = T.toScreen(w, h, { x: x + dx, y: y + dy });
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();

      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      const ah = 6;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(
        q.x - ah * Math.cos(angle - Math.PI / 6),
        q.y - ah * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        q.x - ah * Math.cos(angle + Math.PI / 6),
        q.y - ah * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle = "#4b8";
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawPolyline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: Transform,
  pts: Vec2[],
  style: { stroke: string; width?: number; dash?: number[] } = {
    stroke: "#000",
  }
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width ?? 1.0;
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.beginPath();
  const p0 = T.toScreen(w, h, pts[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const p = T.toScreen(w, h, pts[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawDot(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: Transform,
  p: Vec2,
  sys: System,
  color = "#3367d6"
) {
  const vx = sys.f(p.x, p.y, sys.params);
  const vy = sys.g(p.x, p.y, sys.params);
  const vlen = Math.hypot(vx, vy);

  const s = T.toScreen(w, h, p);
  const r = 2.6;

  if (!sys || vlen < 1e-12) {
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const nx = vx / vlen;
  const ny = vy / vlen;
  const worldStep = 0.02 * Math.min(T.xmax - T.xmin, T.ymax - T.ymin);
  const tipWorld = { x: p.x + nx * worldStep, y: p.y + ny * worldStep };
  const t = T.toScreen(w, h, tipWorld);
  const angle = Math.atan2(t.y - s.y, t.x - s.x);

  const ah = Math.max(6, r * 2.4);
  const spread = Math.PI / 6;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(
    s.x - ah * Math.cos(angle - spread),
    s.y - ah * Math.sin(angle - spread)
  );
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(
    s.x - ah * Math.cos(angle + spread),
    s.y - ah * Math.sin(angle + spread)
  );
  ctx.stroke();
  ctx.restore();
}

type ScalarField = (x: number, y: number) => number;

function lerpZero(
  x1: number,
  y1: number,
  v1: number,
  x2: number,
  y2: number,
  v2: number
) {
  const t = v1 / (v1 - v2);
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

function zeroContourSegments(
  T: Transform,
  field: ScalarField,
  cols: number,
  rows: number
): Array<{ a: Vec2; b: Vec2 }> {
  const segs: Array<{ a: Vec2; b: Vec2 }> = [];

  const dx = (T.xmax - T.xmin) / cols;
  const dy = (T.ymax - T.ymin) / rows;

  const val: number[][] = Array.from({ length: rows + 1 }, (_, j) =>
    Array.from({ length: cols + 1 }, (_, i) => {
      const x = T.xmin + i * dx;
      const y = T.ymin + j * dy;
      const v = field(x, y);
      return Math.abs(v) < 1e-15 ? (v >= 0 ? 1e-15 : -1e-15) : v;
    })
  );

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x0 = T.xmin + i * dx,
        x1 = x0 + dx;
      const y0 = T.ymin + j * dy,
        y1 = y0 + dy;

      const v00 = val[j][i];
      const v10 = val[j][i + 1];
      const v11 = val[j + 1][i + 1];
      const v01 = val[j + 1][i];

      const c =
        (v00 > 0 ? 1 : 0) |
        ((v10 > 0 ? 1 : 0) << 1) |
        ((v11 > 0 ? 1 : 0) << 2) |
        ((v01 > 0 ? 1 : 0) << 3);

      if (c === 0 || c === 15) continue;

      const edgePoint = (edge: number) => {
        switch (edge) {
          case 0:
            return lerpZero(x0, y0, v00, x0, y1, v01);
          case 1:
            return lerpZero(x0, y0, v00, x1, y0, v10);
          case 2:
            return lerpZero(x1, y0, v10, x1, y1, v11);
          case 3:
            return lerpZero(x0, y1, v01, x1, y1, v11);
          default:
            return { x: x0, y: y0 };
        }
      };

      const emit = (a: Vec2, b: Vec2) => segs.push({ a, b });

      switch (c) {
        case 1:
        case 14:
          emit(edgePoint(0), edgePoint(1));
          break;
        case 2:
        case 13:
          emit(edgePoint(1), edgePoint(2));
          break;
        case 3:
        case 12:
          emit(edgePoint(0), edgePoint(2));
          break;
        case 4:
        case 11:
          emit(edgePoint(2), edgePoint(3));
          break;
        case 5:
          emit(edgePoint(0), edgePoint(1));
          emit(edgePoint(2), edgePoint(3));
          break;
        case 6:
        case 9:
          emit(edgePoint(1), edgePoint(3));
          break;
        case 7:
        case 8:
          emit(edgePoint(0), edgePoint(3));
          break;
        case 10:
          emit(edgePoint(0), edgePoint(2));
          emit(edgePoint(1), edgePoint(3));
          break;
      }
    }
  }
  return segs;
}

function stitchSegmentsToPolylines(
  segsScreen: Array<{ a: Vec2; b: Vec2 }>
): Vec2[][] {
  const keyTol = 0.5;
  const key = (p: Vec2) =>
    `${Math.round(p.x / keyTol)}_${Math.round(p.y / keyTol)}`;

  const adj = new Map<string, number[]>();
  const A: Vec2[] = [];
  const B: Vec2[] = [];

  segsScreen.forEach((s, i) => {
    A[i] = s.a;
    B[i] = s.b;
    const ka = key(s.a);
    const kb = key(s.b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push(i);
    adj.get(kb)!.push(i);
  });

  const used = new Array(segsScreen.length).fill(false);
  const polylines: Vec2[][] = [];

  for (let i = 0; i < segsScreen.length; i++) {
    if (used[i]) continue;

    used[i] = true;
    let left = A[i];
    let right = B[i];

    const leftKey = () => key(left);
    const rightKey = () => key(right);

    const chain: Vec2[] = [left, right];
    while (true) {
      const k = rightKey();
      const incident = adj.get(k) || [];
      let advanced = false;
      for (const idx of incident) {
        if (used[idx]) continue;
        let next: Vec2 | null = null;
        if (key(A[idx]) === k) next = B[idx];
        else if (key(B[idx]) === k) next = A[idx];
        if (next) {
          used[idx] = true;
          chain.push(next);
          right = next;
          advanced = true;
          break;
        }
      }
      if (!advanced) break;
    }

    while (true) {
      const k = leftKey();
      const incident = adj.get(k) || [];
      let advanced = false;
      for (const idx of incident) {
        if (used[idx]) continue;
        let next: Vec2 | null = null;
        if (key(A[idx]) === k) next = B[idx];
        else if (key(B[idx]) === k) next = A[idx];
        if (next) {
          used[idx] = true;
          chain.unshift(next);
          left = next;
          advanced = true;
          break;
        }
      }
      if (!advanced) break;
    }

    polylines.push(chain);
  }

  return polylines;
}

function dashPolylineByArclength(
  ctx: CanvasRenderingContext2D,
  poly: Vec2[],
  dashOrientation: "horizontal" | "vertical",
  dashLen: number,
  gapLen: number
) {
  if (poly.length < 2) return;

  const cum: number[] = [0];
  for (let i = 1; i < poly.length; i++) {
    const dx = poly[i].x - poly[i - 1].x;
    const dy = poly[i].y - poly[i - 1].y;
    cum[i] = cum[i - 1] + Math.hypot(dx, dy);
  }
  const total = cum[cum.length - 1];
  if (total <= 1e-3) {
    const p = poly[0];
    ctx.beginPath();
    if (dashOrientation === "horizontal") {
      ctx.moveTo(p.x - dashLen / 2, p.y);
      ctx.lineTo(p.x + dashLen / 2, p.y);
    } else {
      ctx.moveTo(p.x, p.y - dashLen / 2);
      ctx.lineTo(p.x, p.y + dashLen / 2);
    }
    ctx.stroke();
    return;
  }

  const step = dashLen + gapLen;
  let s = dashLen / 2;

  const pointAt = (s: number): Vec2 => {
    let i = 1;
    while (i < cum.length && cum[i] < s) i++;
    const i0 = Math.max(1, i);
    const segLen = cum[i0] - cum[i0 - 1];
    const t = segLen > 0 ? (s - cum[i0 - 1]) / segLen : 0.5;
    const a = poly[i0 - 1];
    const b = poly[i0];
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };

  while (s < total) {
    const c = pointAt(s);
    const cx = Math.round(c.x) + 0.5;
    const cy = Math.round(c.y) + 0.5;

    ctx.beginPath();
    if (dashOrientation === "horizontal") {
      ctx.moveTo(cx - dashLen / 2, cy);
      ctx.lineTo(cx + dashLen / 2, cy);
    } else {
      ctx.moveTo(cx, cy - dashLen / 2);
      ctx.lineTo(cx, cy + dashLen / 2);
    }
    ctx.stroke();

    s += step;
  }
}

function drawZeroContourStitchedDashed(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: Transform,
  field: ScalarField,
  options: {
    density: number;
    width: number;
    dashLen: number;
    gapLen: number;
    dashOrientation: "horizontal" | "vertical";
  }
) {
  const cols = Math.max(8, Math.floor(options.density));
  const rows = cols;

  const segsWorld = zeroContourSegments(T, field, cols, rows);
  const segsScreen = segsWorld.map((s) => ({
    a: T.toScreen(w, h, s.a),
    b: T.toScreen(w, h, s.b),
  }));

  const polylines = stitchSegmentsToPolylines(segsScreen);

  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = options.width;
  ctx.setLineDash([]);

  for (const poly of polylines) {
    if (poly.length < 2) continue;
    dashPolylineByArclength(
      ctx,
      poly,
      options.dashOrientation,
      options.dashLen,
      options.gapLen
    );
  }

  ctx.restore();
}

export function drawNullclines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: Transform,
  sys: System,
  opts?: {
    density?: number;
    width?: number;
    dashLen?: number;
    gapLen?: number;
  }
) {
  const density = opts?.density ?? 72;
  const width = opts?.width ?? 1.6;
  const dashLen = opts?.dashLen ?? 8;
  const gapLen = opts?.gapLen ?? 5;

  drawZeroContourStitchedDashed(
    ctx,
    w,
    h,
    T,
    (x, y) => sys.f(x, y, sys.params),
    {
      density,
      width,
      dashLen,
      gapLen,
      dashOrientation: "vertical",
    }
  );

  drawZeroContourStitchedDashed(
    ctx,
    w,
    h,
    T,
    (x, y) => sys.g(x, y, sys.params),
    {
      density,
      width,
      dashLen,
      gapLen,
      dashOrientation: "horizontal",
    }
  );
}

function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const x1 = a.x,
    y1 = a.y,
    x2 = b.x,
    y2 = b.y;
  const x3 = c.x,
    y3 = c.y,
    x4 = d.x,
    y4 = d.y;

  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-20) return null;

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;

  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;

  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

function newtonPolish(sys: System, p: Vec2, step: number): Vec2 {
  let { x, y } = p;
  const hx = step,
    hy = step;
  for (let it = 0; it < 3; it++) {
    const fx = sys.f(x, y, sys.params);
    const gy = sys.g(x, y, sys.params);
    const f_xph = sys.f(x + hx, y, sys.params);
    const f_xmh = sys.f(x - hx, y, sys.params);
    const f_yph = sys.f(x, y + hy, sys.params);
    const f_ymh = sys.f(x, y - hy, sys.params);

    const g_xph = sys.g(x + hx, y, sys.params);
    const g_xmh = sys.g(x - hx, y, sys.params);
    const g_yph = sys.g(x, y + hy, sys.params);
    const g_ymh = sys.g(x, y - hy, sys.params);

    const a = (f_xph - f_xmh) / (2 * hx);
    const b = (f_yph - f_ymh) / (2 * hy);
    const c = (g_xph - g_xmh) / (2 * hx);
    const d = (g_yph - g_ymh) / (2 * hy);
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-20) break;

    const sx = (-fx * d + b * gy) / det;
    const sy = (-a * gy + fx * c) / det;

    x -= sx;
    y -= sy;
    if (Math.hypot(sx, sy) < 1e-12) break;
  }
  return { x, y };
}

export function findEquilibria(
  T: Transform,
  sys: System,
  opts?: {
    density?: number;
  }
): Vec2[] {
  const cols = Math.max(8, Math.floor(opts?.density ?? 120));
  const rows = cols;

  const segsF = zeroContourSegments(
    T,
    (x, y) => sys.f(x, y, sys.params),
    cols,
    rows
  );
  const segsG = zeroContourSegments(
    T,
    (x, y) => sys.g(x, y, sys.params),
    cols,
    rows
  );

  const candidates: Vec2[] = [];
  for (let i = 0; i < segsF.length; i++) {
    const { a: a1, b: b1 } = segsF[i];
    for (let j = 0; j < segsG.length; j++) {
      const { a: a2, b: b2 } = segsG[j];
      const p = segIntersect(a1, b1, a2, b2);
      if (p) candidates.push(p);
    }
  }

  const tol =
    Math.min((T.xmax - T.xmin) / cols, (T.ymax - T.ymin) / rows) * 0.75;
  const uniq: Vec2[] = [];
  outer: for (const p of candidates) {
    for (const q of uniq) {
      if (Math.hypot(p.x - q.x, p.y - q.y) <= tol) continue outer;
    }
    uniq.push(p);
  }

  const step = tol * 0.5;
  const polished = uniq.map((p) => newtonPolish(sys, p, step));

  return polished;
}

export function drawEquilibria(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: Transform,
  sys: System,
  opts?: {
    density?: number;
    sizePx?: number;
    lineWidth?: number;
    color?: string;
  }
) {
  const density = opts?.density ?? 120;
  const sizePx = opts?.sizePx ?? 12;
  const lineWidth = opts?.lineWidth ?? 2.5;
  const color = opts?.color ?? "#e11d48";

  const points = findEquilibria(T, sys, { density });
  if (!points.length) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  for (const p of points) {
    const s = T.toScreen(w, h, p);
    const x = Math.round(s.x) + 0.5;
    const y = Math.round(s.y) + 0.5;

    ctx.beginPath();
    ctx.arc(x, y, sizePx, 0, 2 * Math.PI);
    ctx.stroke();
  }

  ctx.restore();
}
