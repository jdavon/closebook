"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Check, ChevronsUpDown, Building2, Plus } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { getEntitySubPath } from "@/lib/utils/entity-context";

interface Entity {
  id: string;
  name: string;
  code: string;
  currency?: string;
  fiscal_year_end_month?: number;
}

interface EntitySwitcherProps {
  entities: Entity[];
  currentEntityId?: string;
}

export function EntitySwitcher({ entities, currentEntityId }: EntitySwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const current = entities.find((e) => e.id === currentEntityId);

  const handleSelect = (entityId: string) => {
    setOpen(false);
    const subPath = getEntitySubPath(pathname, currentEntityId);
    router.push(`/${entityId}${subPath}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Building2 className="size-4" />
          </div>
          <div className="flex flex-1 flex-col items-start text-left text-sm leading-tight min-w-0">
            {current ? (
              <>
                <span className="truncate font-semibold w-full">{current.name}</span>
                <span className="truncate text-xs text-muted-foreground w-full">
                  {current.code}
                  {current.currency ? ` · ${current.currency}` : ""}
                </span>
              </>
            ) : (
              <>
                <span className="truncate font-semibold">Select entity</span>
                <span className="truncate text-xs text-muted-foreground">
                  {entities.length} available
                </span>
              </>
            )}
          </div>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[260px] p-0"
        align="start"
        sideOffset={4}
      >
        <Command>
          <CommandInput placeholder="Search entities..." />
          <CommandList>
            <CommandEmpty>No entities found.</CommandEmpty>
            <CommandGroup heading="Entities">
              {entities.map((entity) => (
                <CommandItem
                  key={entity.id}
                  value={`${entity.name} ${entity.code}`}
                  onSelect={() => handleSelect(entity.id)}
                  className="gap-2"
                >
                  <span className="truncate">{entity.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {entity.code}
                  </span>
                  <Check
                    className={cn(
                      "ml-auto size-4 shrink-0",
                      entity.id === currentEntityId ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem asChild>
                <Link
                  href="/settings/reporting-entities"
                  className="gap-2"
                  onClick={() => setOpen(false)}
                >
                  <Plus className="size-4" />
                  <span>Manage entities</span>
                </Link>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
