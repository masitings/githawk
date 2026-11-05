import type { ComponentProps } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export type MenuItem = { label: string; onSelect: () => void; destructive?: boolean } | "-";

export function WithMenu({
  items,
  ...props
}: { items: () => MenuItem[] } & ComponentProps<typeof ContextMenuTrigger>) {
  return (
    <ContextMenu>
      <ContextMenuTrigger {...props} />
      <ContextMenuContent className="min-w-52">
        {items().map((it, i) =>
          it === "-" ? (
            <ContextMenuSeparator key={i} />
          ) : (
            <ContextMenuItem key={i} variant={it.destructive ? "destructive" : "default"} onClick={it.onSelect}>
              {it.label}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
