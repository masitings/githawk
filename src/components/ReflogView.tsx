import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, date, short, type ReflogEntry } from "@/lib/api";
import { WithMenu, type MenuItem } from "@/components/Menu";

type Props = {
  root: string;
  version: number;
  menu: (id: string) => MenuItem[];
  onSelectCommit: (id: string) => void;
  onClose: () => void;
};

export function ReflogView({ root, version, menu, onSelectCommit, onClose }: Props) {
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null);
  useEffect(() => {
    api.reflog(root).then(setEntries).catch((e) => toast.error(String(e)));
  }, [root, version]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Reflog">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-sm">
        <span className="font-medium">Reflog</span>
        <span className="text-xs text-muted-foreground">Every position HEAD has been at. Right-click to restore one.</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </header>
      <ol className="min-h-0 flex-1 overflow-auto py-1">
        {entries?.map((e, i) => (
          <li key={i}>
            <WithMenu
              items={() => menu(e.id)}
              role="button"
              tabIndex={0}
              onClick={() => onSelectCommit(e.id)}
              onKeyDown={(ev: React.KeyboardEvent) => ev.key === "Enter" && onSelectCommit(e.id)}
              className="flex items-center gap-3 px-3 py-1 text-sm hover:bg-muted"
            >
              <code className="w-16 shrink-0 text-xs text-muted-foreground">HEAD@{`{${i}}`}</code>
              <code className="w-16 shrink-0 text-xs">{short(e.id)}</code>
              <span className="flex-1 truncate">{e.message}</span>
              <time className="shrink-0 text-xs text-muted-foreground">{date(e.time)}</time>
            </WithMenu>
          </li>
        ))}
      </ol>
    </section>
  );
}
