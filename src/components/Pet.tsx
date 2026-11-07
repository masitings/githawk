import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { api } from "@/lib/api";
import { addPet, browsePets, choosePet, usePets, type Mood } from "@/lib/pet";
import { getSettings, setSettings, useSettings } from "@/lib/settings";

const CELL_W = 192;
const CELL_H = 208;

// Rows of the Codex pet atlas: [row, frames, fps, loops].
const ANIM = {
  idle: [0, 6, 6, true],
  right: [1, 8, 12, true],
  left: [2, 8, 12, true],
  waving: [3, 4, 5, false],
  jumping: [4, 5, 14, false],
  failed: [5, 8, 6, false],
  waiting: [6, 6, 4, true],
  running: [7, 6, 12, true],
} as const;
type Anim = keyof typeof ANIM;

const IDLE_TO_WAITING_MS = 60_000;

export function Pet({ onSettings }: { onSettings: () => void }) {
  const pet = useSettings().pet;
  const pets = usePets();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const anim = useRef<{ name: Anim; start: number; base: Anim }>({ name: "idle", start: performance.now(), base: "idle" });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [pos, setPos] = useState({ x: pet.x, y: pet.y });
  const lastActive = useRef(performance.now());

  useEffect(() => setPos({ x: pet.x, y: pet.y }), [pet.x, pet.y]);

  useEffect(() => {
    let url = "";
    let live = true;
    setImg(null);
    api.petSprite(pet.id).then(
      (buf) => {
        if (!live) return;
        url = URL.createObjectURL(new Blob([buf]));
        const i = new Image();
        i.onload = () => live && setImg(i);
        i.src = url;
      },
      () => {},
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [pet.id]);

  const play = (name: Anim) => {
    lastActive.current = performance.now();
    anim.current = { ...anim.current, name, start: performance.now() };
  };

  useEffect(() => {
    const onMood = (e: Event) => {
      const mood = (e as CustomEvent<Mood>).detail;
      if (mood === "busy") {
        anim.current.base = "running";
        play("running");
      } else {
        anim.current.base = "idle";
        play(mood === "done" ? "jumping" : "failed");
      }
    };
    window.addEventListener("githawk-pet", onMood);
    return () => window.removeEventListener("githawk-pet", onMood);
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const draw = (now: number) => {
      const a = anim.current;
      if (a.name === "idle" && now - lastActive.current > IDLE_TO_WAITING_MS) a.name = "waiting";
      const [row, frames, fps, loops] = ANIM[a.name];
      let frame = Math.floor(((now - a.start) / 1000) * fps);
      if (!loops && frame >= frames) {
        a.name = a.base;
        a.start = now;
        frame = 0;
      }
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, (frame % frames) * CELL_W, row * CELL_H, CELL_W, CELL_H, 0, 0, c.width, c.height);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [img]);

  if (!img) return null;
  const h = pet.size;
  const w = Math.round((h * CELL_W) / CELL_H);
  const dpr = window.devicePixelRatio || 1;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <canvas
            ref={canvas}
            width={Math.round(w * dpr)}
            height={Math.round(h * dpr)}
            aria-label="Pet"
            className="fixed z-40 cursor-grab touch-none active:cursor-grabbing"
            style={{ width: w, height: h, right: pos.x, bottom: pos.y }}
            onPointerEnter={() => anim.current.name === "idle" || anim.current.name === "waiting" ? play("waving") : (lastActive.current = performance.now())}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const x = Math.min(window.innerWidth - w, Math.max(0, d.px - (e.clientX - d.x)));
              const y = Math.min(window.innerHeight - h, Math.max(0, d.py - (e.clientY - d.y)));
              const dir: Anim = x < pos.x ? "right" : x > pos.x ? "left" : anim.current.name;
              if (dir !== anim.current.name) play(dir);
              setPos({ x, y });
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              if (!d) return;
              if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 4) play("jumping");
              else {
                play(anim.current.base);
                setSettings({ pet: { ...getSettings().pet, x: pos.x, y: pos.y } });
              }
            }}
          />
        }
      />
      <ContextMenuContent className="w-60">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Pet</div>
        <ContextMenuItem onClick={() => setSettings({ pet: { ...getSettings().pet, enabled: false } })}>Hide pet</ContextMenuItem>
        <label className="flex flex-col gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="flex justify-between">
            Size <span>{pet.size}px</span>
          </span>
          <input
            type="range"
            min={60}
            max={320}
            step={10}
            value={pet.size}
            onChange={(e) => setSettings({ pet: { ...getSettings().pet, size: Number(e.currentTarget.value) } })}
            className="accent-primary"
          />
        </label>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Choose pet</ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-48">
            {pets.map((p) => (
              <ContextMenuItem key={p.id} onClick={() => choosePet(p.id)}>
                <Check className={p.id === pet.id ? "" : "invisible"} />
                {p.displayName}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => addPet()}>Add pet from link…</ContextMenuItem>
            <ContextMenuItem onClick={() => browsePets()}>Browse codex-pets.net</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onSettings}>Pet settings…</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
