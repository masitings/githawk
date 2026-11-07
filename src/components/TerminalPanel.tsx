import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "@/lib/api";
import { useSettings, type TerminalPrefs } from "@/lib/settings";

const THEMES = {
  dark: { background: "#0F1113", foreground: "#E8EBEF", cursor: "#F4A62A", selectionBackground: "#2B313A" },
  light: { background: "#FFFFFF", foreground: "#15181C", cursor: "#A35F00", selectionBackground: "#D8DDE3" },
};

const options = (t: TerminalPrefs) => ({
  fontFamily: `'${t.font}', ui-monospace, Menlo, Consolas, monospace`,
  fontSize: t.fontSize,
  lineHeight: t.lineHeight,
  cursorStyle: t.cursor,
  cursorBlink: t.blink,
});

type Props = {
  root: string;
  /** Typed into the shell once it starts. */
  command?: string;
  onOutput?: () => void;
  onExit?: () => void;
};

export function TerminalPanel({ root, command, onOutput, onExit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef({ onOutput, onExit });
  cb.current = { onOutput, onExit };
  const prefs = useSettings().terminal;
  const live = useRef<{ term: Terminal; refit: () => void } | null>(null);

  useEffect(() => {
    if (!live.current) return;
    Object.assign(live.current.term.options, options(prefs));
    live.current.refit();
  }, [prefs]);

  useEffect(() => {
    const el = host.current!;
    const dark = document.documentElement.classList.contains("dark");
    const term = new Terminal({ ...options(prefs), theme: dark ? THEMES.dark : THEMES.light });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    if (el.clientWidth) fit.fit();
    let id: number | null = null;
    let closed = false;
    const unlisten = [
      listen<{ id: number; data: string }>("term-data", (e) => {
        if (e.payload.id !== id) return;
        term.write(e.payload.data);
        cb.current.onOutput?.();
      }),
      listen<number>("term-exit", (e) => {
        if (e.payload !== id) return;
        term.write("\r\n[process exited]\r\n");
        cb.current.onExit?.();
      }),
    ];
    api.termOpen(root, term.cols, term.rows).then((tid) => {
      if (closed) return api.termClose(tid);
      id = tid;
      if (command) api.termWrite(tid, command + "\r");
    });
    const input = term.onData((d) => id !== null && api.termWrite(id, d));
    const refit = () => {
      if (!el.clientWidth) return;
      fit.fit();
      if (id !== null) api.termResize(id, term.cols, term.rows);
    };
    live.current = { term, refit };
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    term.focus();
    return () => {
      closed = true;
      live.current = null;
      ro.disconnect();
      input.dispose();
      unlisten.forEach((u) => u.then((f) => f()));
      if (id !== null) api.termClose(id);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  return (
    <div
      ref={host}
      className={`h-full w-full overflow-hidden px-2 py-1 transition-opacity ${prefs.dimUnfocused ? "opacity-60 focus-within:opacity-100" : ""}`}
      aria-label="Terminal"
    />
  );
}
