import { focusRing } from "./ui.ts";

/** Decision 052 B and H: what to say, and where to go, when GitHub does not let Cockpit read the alerts. Shared by the health line and the screen of the findings. */
export const ACCESS_TEXT: Record<string, string> = {
  app_missing_permissions:
    "L'App ne demande pas les permissions des alertes : coche « Dependabot alerts », « Code scanning alerts » et « Secret scanning alerts » en lecture dans « Permissions & events » de l'App, puis les événements « Dependabot alert », « Code scanning alert » et « Secret scanning alert » dans « Subscribe to events ».",
  installation_not_approved:
    "GitHub attend ton accord pour les nouvelles permissions de l'App.",
  unknown:
    "Impossible de lire les permissions de l'App sur GitHub : réessaie dans une minute.",
};
const ACCESS_LINK: Record<string, string> = {
  app_missing_permissions: "Modifier l'App sur GitHub ↗",
  installation_not_approved: "Approuver sur GitHub ↗",
  // The red webhook line (decision 084 D).
  wrong_url: "Ouvrir les réglages de l'App ↗",
  last_delivery_failed: "Ouvrir les réglages de l'App ↗",
};

export function AccessLink({ detail, url }: { detail: string; url?: string }) {
  const label = ACCESS_LINK[detail];
  return label && url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={`underline ${focusRing}`}
    >
      {label}
    </a>
  ) : null;
}
