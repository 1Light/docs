export type OrgRole = "OrgAdmin" | "OrgOwner" | null;

export type Route =
  | { name: "login" }
  | { name: "signupOwner" }
  | { name: "signupInvite"; token: string }
  | { name: "documents" }
  | { name: "editor"; documentId: string }
  | { name: "admin" }
  | { name: "orgInviteAccept"; token: string }
  | { name: "documentInviteAccept"; token: string };

function hasToken() {
  return !!localStorage.getItem("accessToken");
}

export function getInviteRouteFromUrl(): Extract<Route, { token: string }> | null {
  try {
    const path = window.location.pathname || "";
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");

    if (!token || token.trim().length === 0) return null;

    if (path.startsWith("/invite/org")) {
      return hasToken()
        ? { name: "orgInviteAccept", token: token.trim() }
        : { name: "signupInvite", token: token.trim() };
    }

    if (path.startsWith("/invites/accept")) {
      return { name: "documentInviteAccept", token: token.trim() };
    }

    return null;
  } catch {
    return null;
  }
}

export function getInitialRoute(): Route {
  try {
    const path = window.location.pathname || "";
    const inviteRoute = getInviteRouteFromUrl();

    if (inviteRoute) return inviteRoute;

    if (path.startsWith("/signup")) {
      return { name: "signupOwner" };
    }

    return hasToken() ? { name: "admin" } : { name: "login" };
  } catch {
    return hasToken() ? { name: "admin" } : { name: "login" };
  }
}

export function rememberPendingInvite(route: Extract<Route, { token: string }>) {
  localStorage.setItem("pendingInvite", JSON.stringify(route));
}

export function readPendingInvite(): Extract<Route, { token: string }> | null {
  const raw = localStorage.getItem("pendingInvite");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed.token === "string" &&
      (parsed.name === "orgInviteAccept" ||
        parsed.name === "documentInviteAccept" ||
        parsed.name === "signupInvite")
    ) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

export function takePendingInvite(): Extract<Route, { token: string }> | null {
  const raw = localStorage.getItem("pendingInvite");
  if (!raw) return null;

  localStorage.removeItem("pendingInvite");

  try {
    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed.token === "string" &&
      (parsed.name === "orgInviteAccept" ||
        parsed.name === "documentInviteAccept" ||
        parsed.name === "signupInvite")
    ) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}