import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import {
  alertBox,
  button,
  card,
  field,
  primaryButton,
  sectionLabel,
} from "./ui.ts";
import { fullDate } from "./versions.ts";

export async function fetchPlan() {
  const res = await client.api.me.plan.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The state sentence of Réglages › Abonnement (decision 077 F). */
export function planSentence(plan: Awaited<ReturnType<typeof fetchPlan>>) {
  if (plan.plan === "free")
    return {
      title: "Ton abonnement : Gratuit.",
      rest:
        plan.repos >= (plan.limit ?? 0)
          ? `${plan.repos} repos sur ${plan.limit} utilisés. Passe à Pro pour en ajouter.`
          : `${plan.repos} repos sur ${plan.limit} utilisés.`,
    };
  return {
    title: "Ton abonnement : Pro.",
    rest:
      plan.via === "admin"
        ? "En tant qu'administrateur de l'instance."
        : plan.until
          ? `Par un code, jusqu'au ${fullDate(plan.until)}.`
          : "Par un code, sans fin.",
  };
}

const NOT_OPEN =
  "Le paiement n'est pas encore ouvert. Si on t'a donné un code Pro, saisis-le ci-dessous.";

const Card = ({
  title,
  price,
  items,
  children,
}: {
  title: string;
  price: string;
  items: string[];
  children?: React.ReactNode;
}) => (
  <section className={`${card} flex flex-col gap-2 p-4`}>
    <h2 className="text-lg font-semibold">{title}</h2>
    <p className="font-semibold">{price}</p>
    <ul className="grow list-disc pl-5 text-[13.5px] text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
    {children}
  </section>
);

/** Réglages › Abonnement (S49 as amended by decision 077 F and G): the three offers, the code field, the invoices. */
export function Subscription() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [notOpen, setNotOpen] = useState(false);
  const activate = useMutation({
    mutationFn: async () => {
      const res = await client.api.me["pro-code"].$post(
        {},
        {
          init: {
            body: JSON.stringify({ code }),
            headers: { "content-type": "application/json" },
          },
        },
      );
      if (!res.ok)
        throw new Error(
          res.status === 400
            ? "Ce code n'est pas valable."
            : "L'opération a échoué, réessaie.",
        );
      setCode("");
      // The plan decides the sentence, the limit and the read-only projects: read them all again.
      await queryClient.invalidateQueries();
    },
  });
  const ask = (
    <button type="button" className={button} onClick={() => setNotOpen(true)}>
      Nous contacter
    </button>
  );
  return (
    <div className="grid gap-[22px]">
      <div className="grid gap-3 lg:grid-cols-3">
        <Card
          title="Gratuit"
          price="0 €"
          items={[
            "3 repos, archivés compris",
            "Tickets, US, Kanban",
            "Runs et la nuit de Claude",
            "La jauge « N repos sur 3 »",
          ]}
        />
        <Card
          title="Pro"
          price="10 € par mois ou 96 € par an"
          items={["Repos illimités", "Reprendre une app existante"]}
        >
          <button
            type="button"
            className={primaryButton}
            onClick={() => setNotOpen(true)}
          >
            Passer à Pro
          </button>
        </Card>
        <Card
          title="Entreprise"
          price="Prix selon le besoin"
          items={["Pour une équipe", "Sur mesure"]}
        >
          {ask}
        </Card>
      </div>
      <p role="status" className="text-muted-foreground">
        {notOpen && NOT_OPEN}
      </p>
      <section aria-labelledby="code-pro">
        <h2 id="code-pro" className={sectionLabel}>
          J'ai un code Pro
        </h2>
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            activate.mutate();
          }}
        >
          <label className="grow">
            Code Pro
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              className={field}
            />
          </label>
          <button
            type="submit"
            disabled={!code.trim() || activate.isPending}
            className={primaryButton}
          >
            Activer
          </button>
        </form>
        {activate.error && (
          <p role="alert" className={`mt-3 ${alertBox}`}>
            {activate.error.message}
          </p>
        )}
      </section>
      <section aria-labelledby="factures">
        <h2 id="factures" className={sectionLabel}>
          Factures
        </h2>
        <p className="mt-2 text-muted-foreground">
          Aucune facture pour l'instant.
        </p>
      </section>
    </div>
  );
}
