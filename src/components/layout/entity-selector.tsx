"use client";

import { useRouter } from "next/navigation";
import { Building2, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface Entity {
  id: string;
  name: string;
  code: string;
}

interface EntitySelectorProps {
  entities: Entity[];
  currentEntityId?: string;
}

export function EntitySelector({
  entities,
  currentEntityId,
}: EntitySelectorProps) {
  const router = useRouter();

  const currentEntity = entities.find((e) => e.id === currentEntityId);

  if (entities.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        No entities configured
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-1.5 px-2 h-auto py-1">
          {currentEntity ? (
            <>
              <span className="font-medium">
                {currentEntity.name}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </>
          ) : (
            <>
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Select Entity</span>
              <ChevronsUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {entities.map((entity) => (
          <DropdownMenuItem
            key={entity.id}
            onClick={() => router.push(`/${entity.id}/dashboard`)}
            className={entity.id === currentEntityId ? "bg-accent" : ""}
          >
            <Building2 className="mr-2 h-4 w-4" />
            <div className="flex flex-col">
              <span>{entity.name}</span>
              <span className="text-xs text-muted-foreground">
                {entity.code}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/settings")}>
          <Plus className="mr-2 h-4 w-4" />
          Add Entity
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
