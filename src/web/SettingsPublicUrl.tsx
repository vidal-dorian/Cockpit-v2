import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { focusRing } from "./ui.ts";

const field = `mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 font-mono ${focusRing}`;
const errorBox = "rounded-xl bg-destructive-soft p-4 text-destructive";

/** The origin the server will keep, to show the GitHub steps while the address is typed; the typed text itself until it parses. */
function originOf(typed: string) {
  try {
    // "null" is the origin of a URL such as mailto:x or data:x.
    const { origin } = new URL(typed);
    return origin === "null" ? typed : origin;
  } catch {
    return typed || "<adresse saisie>";
  }
}

/** The administrator's address of Cockpit (decision 023 C): the one Claude and GitHub are told. */
export function PublicUrl() {
  const queryClient = useQueryClient();
  const address = useQuery({
    queryKey: ["public-url"],
    queryFn: async () => {
      const res = await client.api.settings["public-url"].$get();
      if (!res.ok) throw new Error("Impossible de lire l'adresse publique.");
      return res.json();
    },
  });
  const [typed, setTyped] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const res = await client.api.settings["public-url"].$put({
        json: { publicUrl: typed },
      });
      if (!res.ok) {
        // The server's 400 is already a French sentence.
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          (res.status === 400 && body?.error) ||
            "L'opération a échoué, réessaie.",
        );
      }
      setTyped("");
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["public-url"] }),
  });
  const origin = originOf(typed);

  return (
    <section className="mt-8" aria-labelledby="adresse-publique">
      <h2 id="adresse-publique" className="font-heading text-xl font-bold">
        Adresse publique
      </h2>
      <p className="mt-1 text-muted-foreground">
        L'adresse que Cockpit donne à Claude et à GitHub. claude.ai n'accepte
        que le https://.
      </p>
      <div className="mt-4 grid gap-3" aria-live="polite">
        {address.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {address.isError && (
          <p role="alert" className={errorBox}>
            {address.error.message}
          </p>
        )}
        {address.data && (
          <>
            <p className="rounded-xl bg-card p-4">
              Adresse actuelle :{" "}
              <code className="font-mono">{address.data.publicUrl}</code>
            </p>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <label>
                Nouvelle adresse
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  className={field}
                />
              </label>
              <div className="rounded-xl bg-card p-4">
                <p className="font-semibold">
                  D'abord, sur GitHub, dans{" "}
                  <a
                    href={address.data.appSettingsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={`underline ${focusRing}`}
                  >
                    les réglages de l'App
                  </a>{" "}
                  :
                </p>
                <ul className="mt-1 list-disc pl-6">
                  <li>
                    ajoute l'adresse de retour{" "}
                    <code className="font-mono">{`${origin}/api/auth/callback`}</code>{" "}
                    (sans elle, la connexion GitHub échoue) ;
                  </li>
                  <li>
                    remplace l'adresse du webhook par{" "}
                    <code className="font-mono">{`${origin}/api/webhooks/github`}</code>
                    .
                  </li>
                </ul>
                <p className="mt-2">
                  Un connecteur déjà ajouté sur claude.ai avec l'ancienne
                  adresse ne marchera plus : rajoute-le avec la nouvelle.
                </p>
              </div>
              <button
                type="submit"
                disabled={save.isPending}
                className={`justify-self-start min-h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
              >
                Enregistrer l'adresse
              </button>
            </form>
          </>
        )}
        {save.error && (
          <p role="alert" className={errorBox}>
            {save.error.message}
          </p>
        )}
      </div>
    </section>
  );
}
