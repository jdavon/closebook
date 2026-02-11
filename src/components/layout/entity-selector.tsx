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
        <Button variant="ghost" className="gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">
            {currentEntity ? currentEntity.name : "Select Entity"}
          </span>
          {currentEntity && (
            <span className="text-xs text-muted-foreground">
              ({currentEntity.code})
            </span>
          )}
          <ChevronsUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
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
