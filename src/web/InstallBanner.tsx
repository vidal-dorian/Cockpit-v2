import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { client } from "./api.ts";
import { card, primaryButton } from "./ui.ts";

/** Whether the App is installed on the caller's account, and where to install it; null when logged out, throws when GitHub fails. */
export async function fetchInstallation() {
  const res = await client.api.installation.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Reminds a logged-in user that the App is not installed (decision 012 H). Any failure of the check shows nothing: the banner is a reminder, not a gate. */
export function InstallBanner() {
  const installation = useQuery({
    queryKey: ["installation"],
    queryFn: fetchInstallation,
  });
  // The welcome page says it already.
  const { pathname } = useLocation();
  if (pathname === "/bienvenue" || installation.data?.installed !== false)
    return null;
  return (
    <div
      role="status"
      className={`mx-4 mt-4 flex flex-wrap items-center gap-3 ${card} p-4`}
    >
      <p>
        Cockpit n'est pas installé sur ton compte GitHub : sans lui, tu ne peux
        pas importer de projet.
      </p>
      <a href={installation.data.installUrl} className={primaryButton}>
        Installer
      </a>
    </div>
  );
}
