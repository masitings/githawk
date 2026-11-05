import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Field = { name: string; label: string; value?: string; placeholder?: string; optional?: boolean };
type Check = { name: string; label: string; value?: boolean };
type Ask = {
  title: string;
  description?: string;
  /** Read-only text shown in a scrollable block, e.g. generated output. */
  body?: string;
  fields?: Field[];
  checks?: Check[];
  confirm?: string;
  destructive?: boolean;
  /** Shows one button per choice instead of a single confirm button. */
  choices?: string[];
};
type Result = { text: Record<string, string>; checked: Record<string, boolean>; choice?: string };

let show: ((a: Ask, done: (r: Result | null) => void) => void) | null = null;

export function ask(a: Ask): Promise<Result | null> {
  return new Promise((resolve) => (show ? show(a, resolve) : resolve(null)));
}

export const confirm = async (title: string, description?: string, confirm = "Continue") =>
  (await ask({ title, description, confirm, destructive: true })) !== null;

export function PromptHost() {
  const [state, setState] = useState<{ a: Ask; done: (r: Result | null) => void } | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    show = (a, done) => {
      setText(Object.fromEntries((a.fields ?? []).map((f) => [f.name, f.value ?? ""])));
      setChecked(Object.fromEntries((a.checks ?? []).map((c) => [c.name, c.value ?? false])));
      setState({ a, done });
    };
    return () => {
      show = null;
    };
  }, []);

  const close = (r: Result | null) => {
    state?.done(r);
    setState(null);
  };
  const a = state?.a;

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && close(null)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (a?.fields?.some((f) => !f.optional && !text[f.name]?.trim())) return;
            close({ text, checked });
          }}
        >
          <DialogHeader>
            <DialogTitle>{a?.title}</DialogTitle>
            {a?.description && <DialogDescription>{a.description}</DialogDescription>}
          </DialogHeader>
          {a?.body && <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{a.body}</pre>}
          {a?.fields?.map((f, i) => (
            <label key={f.name} className="grid gap-1.5 text-sm">
              {f.label}
              <Input
                autoFocus={i === 0}
                value={text[f.name] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setText({ ...text, [f.name]: e.currentTarget.value })}
              />
            </label>
          ))}
          {a?.checks?.map((c) => (
            <label key={c.name} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked[c.name] ?? false}
                onCheckedChange={(v) => setChecked({ ...checked, [c.name]: v === true })}
              />
              {c.label}
            </label>
          ))}
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="outline" onClick={() => close(null)}>
              Cancel
            </Button>
            {a?.choices ? (
              a.choices.map((c, i) => (
                <Button key={c} type="button" autoFocus={i === 0} onClick={() => close({ text, checked, choice: c })}>
                  {c}
                </Button>
              ))
            ) : (
              <Button type="submit" variant={a?.destructive ? "destructive" : "default"} autoFocus={!a?.fields?.length}>
                {a?.confirm ?? "OK"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
