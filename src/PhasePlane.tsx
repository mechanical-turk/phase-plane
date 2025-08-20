import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { ChipInput } from "./ChipInput";
import {
  type System,
  type Vec2,
  Transform,
  drawVectorField,
  drawAxes,
  integrationBoundsFor,
  integrateBidirectional,
  drawPolyline,
  drawDot,
  drawNullclines,
  drawEquilibria,
} from "./lib";
import { Parser } from "expr-eval";

interface Trajectory {
  seed: Vec2;
  forward: Vec2[];
  backward: Vec2[];
}

const INITIAL_COORDS = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };

const btnBase =
  "inline-flex items-center justify-center rounded-xl text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition active:translate-y-px disabled:cursor-default hover:enabled:cursor-pointer";
const btnGhost =
  "bg-white border border-gray-300 text-gray-900 shadow-sm hover:bg-gray-50 active:bg-gray-100 focus-visible:ring-blue-500 hover:border-gray-400 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 disabled:shadow-none";

const CLICK_EPS = 5;
const ALLOWED_VARS = new Set(["x", "y", "t", "a", "b", "c", "d", "e"]);

export default function PhasePlane() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fieldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniDirRef = useRef<HTMLCanvasElement | null>(null);

  const [dpr, setDpr] = useState(1);
  const [transform, setTransform] = useState(
    () =>
      new Transform(
        INITIAL_COORDS.xmin,
        INITIAL_COORDS.xmax,
        INITIAL_COORDS.ymin,
        INITIAL_COORDS.ymax
      )
  );

  const [showField, setShowField] = useState(true);
  const [showGrid, setshowGrid] = useState(true);
  const [showNullclines, setShowNullclines] = useState(false);
  const [showEquilibria, setShowEquilibria] = useState(false);

  const [fxText, setFxText] = useState<string>("a*x - b*x*y");
  const [gyText, setGyText] = useState<string>("-c*y + d*x*y");
  const [constants, setConstants] = useState<Record<string, string>>({
    t: "0",
    a: "1.1",
    b: "0.4",
    c: "0.4",
    d: "0.1",
    e: "0",
  });

  const isNumeric = (s: string) => {
    if (s.trim() === "") return false;
    const n = Number(s);
    return Number.isFinite(n);
  };

  const invalidConstantKeys = useMemo(
    () => Object.keys(constants).filter((k) => !isNumeric(constants[k])),
    [constants]
  );

  const numericParams = useMemo(
    () => ({
      t: Number(constants.t) || 0,
      a: Number(constants.a) || 0,
      b: Number(constants.b) || 0,
      c: Number(constants.c) || 0,
      d: Number(constants.d) || 0,
      e: Number(constants.e) || 0,
    }),
    [constants]
  );

  const parser = useMemo(
    () =>
      new Parser({
        operators: {
          assignment: false,
          logical: true,
          comparison: true,
          conditional: false,
        },
      }),
    []
  );

  const { fxValid, gyValid } = useMemo(() => {
    const validate = (expr: string) => {
      try {
        const node: any = parser.parse(expr);
        const vars: string[] = (
          typeof node.variables === "function" ? node.variables() : []
        ) as any;
        if (vars.some((v) => !ALLOWED_VARS.has(v))) return false;
        node.toJSFunction("x,y,t,a,b,c,d,e");
        return true;
      } catch {
        return false;
      }
    };
    return { fxValid: validate(fxText), gyValid: validate(gyText) };
  }, [parser, fxText, gyText]);

  const inputsAllValid = fxValid && gyValid && invalidConstantKeys.length === 0;

  const compileSystem = useCallback(
    (fx: string, gy: string, params: Record<string, number>): System => {
      const { t, a, b, c, d, e } = params;
      const argList = "x,y,t,a,b,c,d,e";
      const fJS = parser.parse(fx).toJSFunction(argList) as (
        x: number,
        y: number,
        t: number,
        a: number,
        b: number,
        c: number,
        d: number,
        e: number
      ) => number;
      const gJS = parser.parse(gy).toJSFunction(argList) as (
        x: number,
        y: number,
        t: number,
        a: number,
        b: number,
        c: number,
        d: number,
        e: number
      ) => number;

      const fFast = (x: number, y: number) => fJS(x, y, t, a, b, c, d, e);
      const gFast = (x: number, y: number) => gJS(x, y, t, a, b, c, d, e);

      return {
        f: fFast as any,
        g: gFast as any,
        params: params,
      };
    },
    [parser]
  );

  // Current applied/compiled system (remains valid)
  const [system, setSystem] = useState<System>(() =>
    compileSystem("a*x - b*x*y", "-c*y + d*x*y", {
      t: 0,
      a: 1.1,
      b: 0.4,
      c: 0.4,
      d: 0.1,
      e: 0,
    })
  );

  const [hoverWorld, setHoverWorld] = useState<Vec2 | null>(null);
  const trajectoriesRef = useRef<Trajectory[]>([]);

  const dragging = useRef(false);
  const dragStart = useRef<Vec2>({ x: 0, y: 0 });
  const last = useRef<Vec2>({ x: 0, y: 0 });

  const ensureCanvasSize = useCallback(
    (ref: React.RefObject<HTMLCanvasElement | null>) => {
      const canvas = ref.current;
      if (!canvas)
        return { w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null };
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(200, rect.width);
      const h = Math.max(200, rect.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return { w, h, ctx: null };

      const W = Math.ceil(w * dpr);
      const H = Math.ceil(h * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
      return { w, h, ctx };
    },
    [dpr]
  );

  useEffect(() => {
    const upd = () => setDpr(window.devicePixelRatio || 1);
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  // ---- Rendering helpers ----
  const renderVectorFieldLayer = useCallback(() => {
    if (!showField) return;
    const { w, h, ctx } = ensureCanvasSize(fieldCanvasRef);
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    drawVectorField(ctx, w, h, transform, system, 18);
  }, [ensureCanvasSize, system, transform, showField]);

  const renderMainLayerBase = useCallback(() => {
    const { w, h, ctx } = ensureCanvasSize(mainCanvasRef);
    if (!ctx)
      return { w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null };
    ctx.clearRect(0, 0, w, h);
    drawAxes(ctx, w, h, transform, showGrid);
    return { w, h, ctx };
  }, [ensureCanvasSize, transform, showGrid]);

  const drawTrajectoriesOnly = useCallback(() => {
    const res = renderMainLayerBase();
    const ctx = res.ctx;
    if (!ctx) return;
    for (const traj of trajectoriesRef.current) {
      drawPolyline(ctx, res.w, res.h, transform, traj.backward, {
        stroke: "#3367d6",
      });
      drawPolyline(ctx, res.w, res.h, transform, traj.forward, {
        stroke: "#3367d6",
      });
      drawDot(ctx, res.w, res.h, transform, traj.seed, system);
    }
  }, [renderMainLayerBase, transform, system]);

  const renderMainLayer = useCallback(() => {
    const res = renderMainLayerBase();
    const ctx = res.ctx;
    if (!ctx) return;

    // Draw trajectories (cached)
    for (const traj of trajectoriesRef.current) {
      drawPolyline(ctx, res.w, res.h, transform, traj.backward, {
        stroke: "#3367d6",
      });
      drawPolyline(ctx, res.w, res.h, transform, traj.forward, {
        stroke: "#3367d6",
      });
      drawDot(ctx, res.w, res.h, transform, traj.seed, system);
    }

    // Overlays that depend directly on the system:
    if (showNullclines) {
      drawNullclines(ctx, res.w, res.h, transform, system, {
        density: 200,
        width: 1.2,
        dashLen: 15,
        gapLen: 10,
      });
    }
    if (showEquilibria) {
      drawEquilibria(ctx, res.w, res.h, transform, system, {
        density: 160,
        sizePx: 6,
        lineWidth: 2.5,
      });
    }
  }, [renderMainLayerBase, system, transform, showNullclines, showEquilibria]);

  useEffect(() => {
    renderVectorFieldLayer();
  }, [renderVectorFieldLayer]);

  useEffect(() => {
    renderMainLayer();
  }, [renderMainLayer]);

  const integrateAndDrawSeed = useCallback(
    (seed: Vec2) => {
      const bounds = integrationBoundsFor(transform, seed, 3);
      const { forward, backward } = integrateBidirectional(
        system,
        seed,
        0.001,
        20000,
        bounds
      );

      const { w, h, ctx } = ensureCanvasSize(mainCanvasRef);
      if (!ctx) return;

      drawPolyline(ctx, w, h, transform, backward, { stroke: "#3367d6" });
      drawPolyline(ctx, w, h, transform, forward, { stroke: "#3367d6" });
      drawDot(ctx, w, h, transform, seed, system);

      trajectoriesRef.current = [
        { seed, forward, backward },
        ...trajectoriesRef.current,
      ].slice(0, 1000);
    },
    [ensureCanvasSize, system, transform]
  );

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const canvas = mainCanvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      return transform.toWorld(rect.width, rect.height, { x: px, y: py });
    },
    [transform]
  );

  const addSeedWorld = useCallback(
    (seed: Vec2) => {
      integrateAndDrawSeed(seed);
    },
    [integrateAndDrawSeed]
  );

  const addSeedAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const seed = clientToWorld(clientX, clientY);
      addSeedWorld(seed);
    },
    [clientToWorld, addSeedWorld]
  );

  useEffect(() => {
    if (!inputsAllValid) return;
    const id = window.setTimeout(() => {
      const next = compileSystem(fxText, gyText, { ...numericParams });
      setSystem(next);

      trajectoriesRef.current = [];

      renderVectorFieldLayer();
      drawTrajectoriesOnly();
    }, 150);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsAllValid, fxText, gyText, numericParams]);

  const [spawning, setSpawning] = useState(false);
  const addRandomTrajectories = useCallback(async () => {
    if (spawning) return;
    setSpawning(true);

    const { xmin, xmax, ymin, ymax } = transform;
    const tick = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    for (let i = 0; i < 10; i++) {
      const x = xmin + Math.random() * (xmax - xmin);
      const y = ymin + Math.random() * (ymax - ymin);
      addSeedWorld({ x, y });
      await tick();
    }

    setSpawning(false);
  }, [transform, addSeedWorld, spawning]);

  const hasInvalid = !inputsAllValid;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hasInvalid) return;
      if (e.key === "Tab") {
        e.preventDefault();
        alert("Please fix invalid inputs before leaving the field.");
      }
    };
    const handleMouseDownCapture = (e: MouseEvent) => {
      if (!hasInvalid) return;
      if (!rootRef.current) return;
      const sidebar = rootRef.current.querySelector("aside");
      if (sidebar && !sidebar.contains(e.target as Node)) {
        e.stopPropagation();
        e.preventDefault();
        alert("Please fix invalid inputs before continuing.");
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("mousedown", handleMouseDownCapture, {
      capture: true,
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown, {
        capture: true,
      } as any);
      document.removeEventListener("mousedown", handleMouseDownCapture, {
        capture: true,
      } as any);
    };
  }, [hasInvalid]);

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    last.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const world = clientToWorld(e.clientX, e.clientY);
    setHoverWorld(world);
    if (!dragging.current) return;

    const canvas = mainCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();

    const dxPx = e.clientX - last.current.x;
    const dyPx = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };

    const dxWorld = (-dxPx / rect.width) * (transform.xmax - transform.xmin);
    const dyWorld = (dyPx / rect.height) * (transform.ymax - transform.ymin);

    setTransform((t) => {
      const nt = new Transform(t.xmin, t.xmax, t.ymin, t.ymax);
      nt.pan(dxWorld, dyWorld);
      return nt;
    });
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    dragging.current = false;

    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= CLICK_EPS) addSeedAtClientPoint(e.clientX, e.clientY);
  };

  const onMouseLeave = () => {
    dragging.current = false;
    setHoverWorld(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = mainCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const world = transform.toWorld(rect.width, rect.height, { x: px, y: py });
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;

    setTransform((t) => {
      const nt = new Transform(t.xmin, t.xmax, t.ymin, t.ymax);
      nt.zoom(world.x, world.y, factor);
      return nt;
    });
  };

  const clearTrajectories = () => {
    trajectoriesRef.current = [];
    drawTrajectoriesOnly();
  };

  const resetView = () => {
    setTransform(
      new Transform(
        INITIAL_COORDS.xmin,
        INITIAL_COORDS.xmax,
        INITIAL_COORDS.ymin,
        INITIAL_COORDS.ymax
      )
    );
  };

  const fmt = (v: number) => (Math.abs(v) < 1e-6 ? "0" : v.toFixed(3));

  const renderMiniDirection = useCallback(
    (angleScreen: number | null) => {
      const canvas = miniDirRef.current;
      if (!canvas) return;

      const cssSize = 24;
      const ratio = dpr || window.devicePixelRatio || 1;

      canvas.width = cssSize * ratio;
      canvas.height = cssSize * ratio;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, cssSize, cssSize);

      if (angleScreen == null) return;

      ctx.save();
      ctx.translate(cssSize / 2, cssSize / 2);
      ctx.rotate(angleScreen);

      ctx.strokeStyle = "#fff";
      ctx.fillStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();

      const ah = 5;
      const spread = Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(6 - ah * Math.cos(spread), ah * Math.sin(spread));
      ctx.lineTo(6 - ah * Math.cos(spread), -ah * Math.sin(spread));
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    },
    [dpr]
  );

  useEffect(() => {
    if (!hoverWorld) {
      renderMiniDirection(null);
      return;
    }

    const { w, h } = ensureCanvasSize(mainCanvasRef);
    const { x, y } = hoverWorld;

    const vx = system.f(x, y, system.params);
    const vy = system.g(x, y, system.params);
    const vlen = Math.hypot(vx, vy);

    if (vlen < 1e-12) {
      const mini = miniDirRef.current;
      if (mini) {
        const ratio = dpr || window.devicePixelRatio || 1;
        const cssSize = 24;
        mini.width = cssSize * ratio;
        mini.height = cssSize * ratio;
        const c2d = mini.getContext("2d");
        if (c2d) {
          c2d.setTransform(ratio, 0, 0, ratio, 0, 0);
          c2d.clearRect(0, 0, cssSize, cssSize);
          c2d.fillStyle = "#4b8";
          c2d.beginPath();
          c2d.arc(cssSize / 2, cssSize / 2, 3, 0, Math.PI * 2);
          c2d.fill();
        }
      }
      return;
    }

    const nx = vx / vlen;
    const ny = vy / vlen;
    const worldStep =
      0.02 *
      Math.min(
        transform.xmax - transform.xmin,
        transform.ymax - transform.ymin
      );
    const s = transform.toScreen(w, h, { x, y });
    const tPt = transform.toScreen(w, h, {
      x: x + nx * worldStep,
      y: y + ny * worldStep,
    });
    const angle = Math.atan2(tPt.y - s.y, tPt.x - s.x);

    renderMiniDirection(angle);
  }, [
    hoverWorld,
    system,
    transform,
    dpr,
    ensureCanvasSize,
    renderMiniDirection,
  ]);

  return (
    <div ref={rootRef} className="w-full p-4">
      <div className="w-full flex gap-4">
        <aside className="w-60 shrink-0 rounded-2xl border shadow p-4 flex flex-col gap-4">
          <div>
            <div className="text-sm font-semibold">Phase Plane Plotter</div>
          </div>

          <div className="flex flex-col gap-3">
            <ChipInput
              label={"x'"}
              value={fxText}
              onChange={setFxText}
              placeholder="e.g., a*x - b*x*y"
              invalid={!fxValid}
            />
            <ChipInput
              label={"y'"}
              value={gyText}
              onChange={setGyText}
              placeholder="e.g., -c*y + d*x*y"
              invalid={!gyValid}
            />
          </div>

          <div className="flex flex-col gap-2 pt-3">
            <div className="grid grid-cols-3 gap-2">
              {(["t", "a", "b", "c", "d", "e"] as const).map((k) => {
                const invalid = !isNumeric(constants[k]);
                return (
                  <ChipInput
                    key={k}
                    label={k}
                    value={constants[k]}
                    onChange={(v) =>
                      setConstants((prev) => ({ ...prev, [k]: v }))
                    }
                    placeholder="0"
                    invalid={invalid}
                    compact
                  />
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showField}
                onChange={(e) => {
                  setShowField(e.target.checked);
                  if (e.target.checked) renderVectorFieldLayer();
                  else {
                    const { w, h, ctx } = ensureCanvasSize(fieldCanvasRef);
                    if (ctx) ctx.clearRect(0, 0, w, h);
                  }
                }}
              />
              Vector field
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => {
                  setshowGrid(e.target.checked);
                  renderMainLayer();
                }}
              />
              Grid
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showNullclines}
                onChange={(e) => {
                  setShowNullclines(e.target.checked);
                  renderMainLayer();
                }}
              />
              Nullclines
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showEquilibria}
                onChange={(e) => {
                  setShowEquilibria(e.target.checked);
                  renderMainLayer();
                }}
              />
              Equilibria
            </label>
          </div>

          <div className="flex flex-col gap-2 pt-3">
            <button
              type="button"
              className={`${btnBase} ${btnGhost} px-3 py-2`}
              onClick={addRandomTrajectories}
              disabled={spawning}
              title={
                spawning ? "Adding trajectories…" : "Add 10 random trajectories"
              }
            >
              {spawning ? "Adding…" : "Add Random Trajectories"}
            </button>
            <button
              type="button"
              className={`${btnBase} ${btnGhost} px-3 py-2 text-left`}
              onClick={clearTrajectories}
            >
              Clear Trajectories
            </button>
            <button
              type="button"
              className={`${btnBase} ${btnGhost} px-3 py-2 text-left`}
              onClick={resetView}
            >
              Reset View
            </button>
          </div>
        </aside>

        <main className="flex-1 rounded-2xl overflow-hidden border shadow relative">
          <div className="h-full relative">
            <canvas
              ref={fieldCanvasRef}
              className="absolute -inset-px w-[calc(100%+2px)] h-[calc(100%+2px)] bg-white"
              style={{ zIndex: 0, display: "block" }}
            />
            <canvas
              ref={mainCanvasRef}
              className="absolute -inset-px w-[calc(100%+2px)] h-[calc(100%+2px)]"
              style={{ zIndex: 1, background: "transparent" }}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
              onMouseMove={onMouseMove}
              onWheel={onWheel}
            />
            {hoverWorld && (
              <div
                className="absolute bottom-2 right-2 flex items-center gap-1"
                style={{ pointerEvents: "none", zIndex: 2 }}
              >
                <div className="text-xs bg-black/70 text-white px-2 py-1 rounded-md">
                  (x: {fmt(hoverWorld.x)}, y: {fmt(hoverWorld.y)})
                </div>
                <canvas
                  ref={miniDirRef}
                  className="h-6 w-6 rounded-md bg-black/70 shadow-sm"
                />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
