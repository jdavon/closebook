"use client";

import { createContext, useContext } from "react";
import type { UserRole } from "@/lib/types/database";

export interface EntityContextValue {
  entityId: string;
  entityName: string;
  entityCode: string;
  userRole: UserRole;
}

export const EntityContext = createContext<EntityContextValue | null>(null);

export function useEntity() {
  const context = useContext(EntityContext);
  if (!context) {
    throw new Error("useEntity must be used within an EntityProvider");
  }
  return context;
}

export function useOptionalEntity() {
  return useContext(EntityContext);
}
