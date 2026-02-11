import type { UserRole } from "@/lib/types/database";

const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 4,
  controller: 3,
  reviewer: 2,
  preparer: 1,
};

export function hasMinRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function canManageClose(role: UserRole): boolean {
  return hasMinRole(role, "controller");
}

export function canReview(role: UserRole): boolean {
  return hasMinRole(role, "reviewer");
}

export function canPrepare(role: UserRole): boolean {
  return hasMinRole(role, "preparer");
}

export function canManageOrg(role: UserRole): boolean {
  return role === "admin";
}

export function canManageEntity(role: UserRole): boolean {
  return hasMinRole(role, "controller");
}

export function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    admin: "Admin",
    controller: "Controller",
    reviewer: "Reviewer",
    preparer: "Preparer",
  };
  return labels[role];
}
