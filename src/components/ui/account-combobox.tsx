"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/command";

export interface AccountOption {
  id: string;
  account_number?: string | null;
  name: string;
  account_type?: string;
  secondary?: string;
}

interface AccountComboboxProps {
  accounts: AccountOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
}

export function AccountCombobox({
  accounts,
  value,
  onValueChange,
  placeholder = "Select account...",
  searchPlaceholder = "Search accounts...",
  emptyMessage = "No account found.",
  className,
  disabled,
}: AccountComboboxProps) {
  const [open, setOpen] = React.useState(false);

  const selected = accounts.find((a) => a.id === value);

  const displayLabel = selected
    ? `${selected.account_number ? `${selected.account_number} — ` : ""}${selected.name}`
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full min-w-0 justify-between text-sm font-normal overflow-hidden",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.account_number ?? ""} ${a.name} ${a.account_type ?? ""} ${a.secondary ?? ""}`}
                  onSelect={() => {
                    onValueChange(a.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === a.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">
                    {a.account_number ? `${a.account_number} — ` : ""}
                    {a.name}
                    {a.account_type && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        ({a.account_type})
                      </span>
                    )}
                    {a.secondary && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        {a.secondary}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
