const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function detectEntityId(pathname: string): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length >= 1 && UUID_PATTERN.test(segments[0])) {
    return segments[0];
  }
  return undefined;
}

export function isEntityRoute(pathname: string): boolean {
  return detectEntityId(pathname) !== undefined;
}

export function getEntitySubPath(
  pathname: string,
  entityId: string | undefined
): string {
  if (!entityId) return "/dashboard";
  const prefix = `/${entityId}`;
  if (pathname.startsWith(prefix)) {
    const sub = pathname.slice(prefix.length);
    return sub || "/dashboard";
  }
  return "/dashboard";
}
