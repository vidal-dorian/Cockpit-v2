import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { StateSentence } from "./Shell.tsx";
import {
  alertBox,
  field,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

const amount = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// A non-breaking space keeps the sign on the number's line.
export const dollars = (n: number) => `${amount.format(n)}\u00a0$`;

/** The caps of the user in dollars (decision 060 C), read by the page « Coût » and by the panel « Développer avec Claude ». */
export async function fetchBudgets() {
  const res = await client.api.me.budgets.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}
async function fetchCost() {
  const res = await client.api.claude.cost.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

type Budgets = Awaited<ReturnType<typeof fetchBudgets>>;

const FIELDS = [
  ["runUsd", "Plafond par run"],
  ["nightUsd", "Plafond par nuit"],
  ["monthUsd", "Plafond par mois"],
] as const;

function BudgetsForm({ initial }: { initial: Budgets }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() =>
    Object.fromEntries(FIELDS.map(([key]) => [key, `${initial[key] ?? ""}`])),
  );
  const save = useMutation({
    mutationFn: async () => {
      const [runUsd, nightUsd, monthUsd] = FIELDS.map(([key]) =>
        values[key] ? Number(values[key]) : null,
      );
      const res = await client.api.me.budgets.$put({
        json: {
          runUsd: runUsd ?? null,
          nightUsd: nightUsd ?? null,
          monthUsd: monthUsd ?? null,
        },
      });
      if (!res.ok)
        throw new Error("Plafonds refusés : indique des montants positifs.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["budgets"] }),
  });
  return (
    <form
      className={`grid gap-3 px-[18px] py-3.5 ${listCard}`}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-muted-foreground">
        En dollars, facultatifs. Au plafond d'un run, Cockpit demande l'arrêt ;
        au plafond du mois, plus aucun lancement ne part.
      </p>
      {FIELDS.map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min="0"
            step="any"
            className={field}
            value={values[key]}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          />
        </label>
      ))}
      {save.isError && (
        <p role="alert" className={alertBox}>
          {save.error.message}
        </p>
      )}
      {save.isSuccess && <p role="status">Plafonds enregistrés.</p>}
      <button
        type="submit"
        disabled={save.isPending}
        aria-busy={save.isPending}
        className={`justify-self-start ${primaryButton}`}
      >
        Enregistrer
      </button>
    </form>
  );
}

/** Decision 060 F: the page « Coût », what Claude cost this month and the caps. */
export function Cost() {
  const cost = useQuery({ queryKey: ["cost"], queryFn: fetchCost });
  const budgets = useQuery({ queryKey: ["budgets"], queryFn: fetchBudgets });
  const data = cost.data;
  const month = budgets.data?.monthUsd ?? null;
  const cell = (label: string, value: number | null) => (
    <div className={`${listCard} px-[18px] py-3.5`}>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">
        {value === null ? "—" : dollars(value)}
      </p>
    </div>
  );
  return (
    <main>
      <StateSentence
        title={
          data ? `Claude a coûté ${dollars(data.monthUsd)} ce mois-ci.` : "Coût"
        }
        actions={
          <Link to="/claude" className="underline">
            Claude
          </Link>
        }
      />
      <div className="grid gap-6 px-[26px] py-6">
        {cost.isError && (
          <p role="alert" className={alertBox}>
            Impossible de lire le coût. Recharge la page ; si cela continue,
            réessaie plus tard.
          </p>
        )}
        {cost.isPending && (
          <p className="loading text-muted-foreground">Chargement…</p>
        )}
        {data && (
          <>
            <section
              aria-label="Ce mois-ci"
              className="grid gap-3 sm:grid-cols-3"
            >
              <div className={`${listCard} px-[18px] py-3.5`}>
                <p className="text-muted-foreground">Ce mois-ci</p>
                <p className="text-lg font-semibold">
                  {dollars(data.monthUsd)}
                </p>
                {month !== null && (
                  <>
                    <div
                      role="progressbar"
                      aria-label="Part du plafond par mois"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(
                        100,
                        Math.round((data.monthUsd / month) * 100),
                      )}
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"
                    >
                      <div
                        className="h-full bg-foreground"
                        style={{
                          width: `${Math.min(100, (data.monthUsd / month) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-[12.5px] text-muted-foreground">
                      {Math.round((data.monthUsd / month) * 100)} % du plafond
                      de {dollars(month)}
                    </p>
                  </>
                )}
              </div>
              {cell("Par run en moyenne", data.runAverageUsd)}
              {cell("Par PR mergée ce mois-ci", data.perMergedPrUsd)}
            </section>
            <section aria-labelledby="par-projet">
              <h2 id="par-projet" className={sectionLabel}>
                Par projet
              </h2>
              <ul className={`mt-2 ${listCard}`}>
                {data.projects.map((p) => (
                  <li
                    key={p.id}
                    className="flex min-h-[50px] items-center gap-3 px-[18px] py-2.5"
                  >
                    <Link to={`/projets/${p.id}`} className="font-semibold">
                      {p.name}
                    </Link>
                    <span className="ml-auto">{dollars(p.costUsd)}</span>
                  </li>
                ))}
                {data.projects.length === 0 && (
                  <li className="min-h-[50px] px-[18px] py-2.5 text-muted-foreground">
                    Aucun coût ce mois-ci.
                  </li>
                )}
              </ul>
            </section>
            <section aria-labelledby="plafonds">
              <h2 id="plafonds" className={`${sectionLabel} mb-2`}>
                Plafonds
              </h2>
              {budgets.data && <BudgetsForm initial={budgets.data} />}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
