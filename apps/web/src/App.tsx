import { useEffect, useMemo, useState } from "react";
import { me as fetchMe, logout, deleteAccount as deleteAccountApi } from "./features/auth/api";
import { disconnectSocket } from "./features/realtime/socket";

import { Login } from "./features/auth/pages/Login";
import { SignupOwner } from "./features/auth/pages/SignupOwner";
import { SignupInvite } from "./features/auth/pages/SignupInvite";
import { Documents } from "./features/documents/pages/Documents";
import { EditorPage } from "./features/editor/pages/Editor";
import { AdminPage } from "./features/admin/pages/Admin";

import { AppHeader } from "./components/layout/AppHeader";

import {
  type Route,
  getInitialRoute,
  getInviteRouteFromUrl,
  rememberPendingInvite,
  readPendingInvite,
  takePendingInvite,
} from "./app/routes";

import {
  hasToken,
  readMeLocal,
  normalizeMe,
  clearSession,
  type MeUser,
} from "./app/session";

import { acceptDocumentInviteToken, acceptOrgInviteToken } from "./app/invite";

export default function App() {
  const [route, setRoute] = useState<Route>(() => getInitialRoute());
  const [authChecked, setAuthChecked] = useState(false);
  const [me, setMe] = useState<MeUser | null>(() => readMeLocal());
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const isAdmin = useMemo(
    () => me?.orgRole === "OrgAdmin" || me?.orgRole === "OrgOwner",
    [me]
  );

  const isOrgOwner = me?.orgRole === "OrgOwner";

  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        disconnectSocket();
      } catch {
        // ignore
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      const inviteRoute = getInviteRouteFromUrl();

      if (inviteRoute?.name === "documentInviteAccept" && !hasToken()) {
        rememberPendingInvite(inviteRoute);
        if (alive) {
          setAuthChecked(true);
          setRoute({ name: "login" });
        }
        return;
      }

      if (!hasToken()) {
        if (alive) {
          setAuthChecked(true);

          if (inviteRoute?.name === "signupInvite") {
            setRoute(inviteRoute);
          } else {
            const initial = getInitialRoute();
            setRoute(initial.name === "admin" ? { name: "login" } : initial);
          }
        }
        return;
      }

      try {
        const u = await fetchMe();
        if (!alive) return;

        const normalized = normalizeMe(u);
        setMe(normalized);
        localStorage.setItem("me", JSON.stringify(normalized));

        const pending = takePendingInvite();
        if (pending) {
          if (pending.name === "signupInvite") {
            setRoute(
              normalized.orgRole === "OrgAdmin" || normalized.orgRole === "OrgOwner"
                ? { name: "admin" }
                : { name: "documents" }
            );
            return;
          }

          setRoute(pending);
          return;
        }

        setRoute((currentRoute) => {
          if (
            currentRoute.name === "editor" ||
            currentRoute.name === "documents" ||
            currentRoute.name === "orgInviteAccept" ||
            currentRoute.name === "documentInviteAccept"
          ) {
            return currentRoute;
          }

          return normalized.orgRole === "OrgAdmin" || normalized.orgRole === "OrgOwner"
            ? { name: "admin" }
            : { name: "documents" };
        });
      } catch {
        try {
          disconnectSocket();
        } catch {
          // ignore
        }

        clearSession();

        if (!alive) return;
        setMe(null);

        const initial = getInitialRoute();
        setRoute(initial.name === "admin" ? { name: "login" } : initial);
      } finally {
        if (alive) setAuthChecked(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  async function loadCurrentUserAndRouteAfterLogin() {
    try {
      const u = await fetchMe();
      const normalized = normalizeMe(u);

      setMe(normalized);
      localStorage.setItem("me", JSON.stringify(normalized));

      const pending = takePendingInvite();
      if (pending) {
        if (pending.name === "orgInviteAccept" || pending.name === "documentInviteAccept") {
          setRoute(pending);
          return;
        }

        if (pending.name === "signupInvite") {
          setRoute(
            normalized.orgRole === "OrgAdmin" || normalized.orgRole === "OrgOwner"
              ? { name: "admin" }
              : { name: "documents" }
          );
          return;
        }
      }

      setRoute(
        normalized.orgRole === "OrgAdmin" || normalized.orgRole === "OrgOwner"
          ? { name: "admin" }
          : { name: "documents" }
      );
    } catch {
      try {
        disconnectSocket();
      } catch {
        // ignore
      }

      clearSession();
      setMe(null);
      setRoute({ name: "login" });
    }
  }

  async function doLogout() {
    try {
      disconnectSocket();
    } catch {
      // ignore
    }

    await logout();

    clearSession();
    setMe(null);
    setRoute({ name: "login" });
  }

  async function handleDeleteAccount() {
    if (!me || isDeletingAccount) return;

    if (me.orgRole === "OrgOwner") {
      window.alert("Organization owners cannot delete their account.");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to delete your account? This action cannot be undone."
    );

    if (!confirmed) return;

    try {
      setIsDeletingAccount(true);
      await deleteAccountApi();
      clearSession();
      setMe(null);
      setRoute({ name: "login" });
      window.alert("Your account has been deleted.");
    } catch (e: any) {
      window.alert(e?.message ?? "Failed to delete account");
    } finally {
      setIsDeletingAccount(false);
    }
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-600">
        Loading...
      </div>
    );
  }

  const inAdmin = route.name === "admin";

  const isAuthPage =
    route.name === "login" || route.name === "signupOwner" || route.name === "signupInvite";

  const pendingInviteForLogin = !hasToken() ? readPendingInvite() : null;
  const loginInviteMode =
    pendingInviteForLogin?.name === "orgInviteAccept" ||
    pendingInviteForLogin?.name === "signupInvite";
  const loginInviteToken = loginInviteMode ? pendingInviteForLogin?.token : undefined;

  return (
    <div className="min-h-screen bg-gray-50">
      {!isAuthPage && (
        <AppHeader
          me={me}
          isAdmin={isAdmin}
          isOrgOwner={isOrgOwner}
          inAdmin={inAdmin}
          onToggleAdmin={() => setRoute(inAdmin ? { name: "documents" } : { name: "admin" })}
          onDeleteAccount={handleDeleteAccount}
          onLogout={doLogout}
        />
      )}

      {route.name === "login" && (
        <Login
          onLoggedIn={loadCurrentUserAndRouteAfterLogin}
          onGoToSignupOwner={() => setRoute({ name: "signupOwner" })}
          inviteMode={loginInviteMode}
          inviteToken={loginInviteToken}
        />
      )}

      {route.name === "signupOwner" && (
        <SignupOwner
          onSignedUp={loadCurrentUserAndRouteAfterLogin}
          onGoToLogin={() => setRoute({ name: "login" })}
        />
      )}

      {route.name === "signupInvite" && (
        <SignupInvite
          token={route.token}
          onSignedUp={loadCurrentUserAndRouteAfterLogin}
          onGoToLogin={() => {
            rememberPendingInvite({ name: "orgInviteAccept", token: route.token });
            setRoute({ name: "login" });
          }}
        />
      )}

      {route.name === "orgInviteAccept" && (
        <OrgInviteAcceptView
          token={route.token}
          meEmail={me?.email}
          onSwitchAccount={async () => {
            rememberPendingInvite(route);
            await doLogout();
          }}
          onAccepted={() => {
            setRoute(isAdmin ? { name: "admin" } : { name: "documents" });
          }}
          onCancel={() =>
            setRoute(hasToken() ? (isAdmin ? { name: "admin" } : { name: "documents" }) : { name: "login" })
          }
        />
      )}

      {route.name === "documentInviteAccept" && (
        <DocumentInviteAcceptView
          token={route.token}
          meEmail={me?.email}
          onSwitchAccount={async () => {
            rememberPendingInvite(route);
            await doLogout();
          }}
          onAccepted={() => {
            setRoute({ name: "documents" });
          }}
          onCancel={() =>
            setRoute(hasToken() ? (isAdmin ? { name: "admin" } : { name: "documents" }) : { name: "login" })
          }
        />
      )}

      {route.name === "documents" && (
        <Documents onOpenDocument={(documentId) => setRoute({ name: "editor", documentId })} />
      )}

      {route.name === "editor" && (
        <EditorPage documentId={route.documentId} onBack={() => setRoute({ name: "documents" })} />
      )}

      {route.name === "admin" && <AdminPage onBack={() => setRoute({ name: "documents" })} />}
    </div>
  );
}

function OrgInviteAcceptView(props: {
  token: string;
  meEmail?: string;
  onAccepted: () => void;
  onSwitchAccount: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "accepting" | "accepted" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setStatus("accepting");
      setError(null);

      try {
        const out = await acceptOrgInviteToken(props.token);
        if (!alive) return;

        if (out?.joined) {
          setStatus("accepted");
          props.onAccepted();
          return;
        }

        setStatus("error");
        setError("Invite could not be accepted.");
      } catch (e: any) {
        if (!alive) return;
        setStatus("error");
        setError(e?.message ?? "Failed to accept organization invite");
      }
    })();

    return () => {
      alive = false;
    };
  }, [props.token]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="text-sm font-semibold text-gray-900">Accept organization invite</div>
        <div className="mt-1 text-xs text-gray-600">
          We’ll add you to the organization after you accept.
        </div>

        {status === "accepting" && <div className="mt-4 text-sm text-gray-700">Accepting invite...</div>}

        {status === "error" && (
          <div className="mt-4">
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {error ?? "Failed to accept invite"}
            </div>

            <div className="mt-3 text-xs text-gray-600">
              {props.meEmail ? (
                <>
                  You are currently logged in as: <span className="font-medium">{props.meEmail}</span>.
                </>
              ) : (
                <>You may be logged in with the wrong account.</>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={props.onSwitchAccount}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Switch account
              </button>

              <button
                type="button"
                onClick={props.onCancel}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === "accepted" && <div className="mt-4 text-sm text-gray-700">Accepted. Redirecting...</div>}
      </div>
    </div>
  );
}

function DocumentInviteAcceptView(props: {
  token: string;
  meEmail?: string;
  onAccepted: () => void;
  onSwitchAccount: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "accepting" | "accepted" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setStatus("accepting");
      setError(null);

      try {
        const out = await acceptDocumentInviteToken(props.token);
        if (!alive) return;

        if (out?.accepted) {
          setStatus("accepted");
          props.onAccepted();
          return;
        }

        setStatus("error");
        setError("Invite could not be accepted.");
      } catch (e: any) {
        if (!alive) return;
        setStatus("error");
        setError(e?.message ?? "Failed to accept document invite");
      }
    })();

    return () => {
      alive = false;
    };
  }, [props.token]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="text-sm font-semibold text-gray-900">Accept document invite</div>
        <div className="mt-1 text-xs text-gray-600">
          We’ll add the document to your workspace after you accept.
        </div>

        {status === "accepting" && <div className="mt-4 text-sm text-gray-700">Accepting invite...</div>}

        {status === "error" && (
          <div className="mt-4">
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {error ?? "Failed to accept invite"}
            </div>

            <div className="mt-3 text-xs text-gray-600">
              {props.meEmail ? (
                <>
                  You are currently logged in as: <span className="font-medium">{props.meEmail}</span>.
                </>
              ) : (
                <>You may be logged in with the wrong account.</>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={props.onSwitchAccount}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Switch account
              </button>

              <button
                type="button"
                onClick={props.onCancel}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === "accepted" && <div className="mt-4 text-sm text-gray-700">Accepted. Redirecting...</div>}
      </div>
    </div>
  );
}