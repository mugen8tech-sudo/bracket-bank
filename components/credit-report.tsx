"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/* helper: konversi tanggal lokal Jakarta -> ISO UTC untuk filter submitted_at */
const toIsoStartJakarta = (d?: string) =>
  d ? new Date(`${d}T00:00:00+07:00`).toISOString() : null;
const toIsoEndJakarta = (d?: string) =>
  d ? new Date(`${d}T23:59:59.999+07:00`).toISOString() : null;

type Report = {
  dp_count: number;
  wd_count: number;
  trx_total: number;
  credit_bonus: number;
  credit_in: number;
  credit_out: number;
  credit_balance: number; // = credit_in - credit_out
};

export default function CreditReport() {
  const supabase = supabaseBrowser();

  const [brand, setBrand] = useState("TECH");
  const [tenantId, setTenantId] = useState<string | null>(null);

  // filter header (Start–Finish → submitted_at)
  const [fStart, setFStart] = useState<string>("");
  const [fFinish, setFFinish] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [rpt, setRpt] = useState<Report | null>(null);

  // bootstrap tenant + brand (untuk judul)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user.id)
        .single();

      if (prof?.tenant_id) {
        setTenantId(prof.tenant_id);
        const { data: tenant } = await supabase
          .from("tenants")
          .select("slug, name")
          .eq("id", prof.tenant_id)
          .single();
        setBrand(tenant?.slug || tenant?.name || "—");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_credit_report", {
      p_start: toIsoStartJakarta(fStart) as any,
      p_finish: toIsoEndJakarta(fFinish) as any,
    });
    setLoading(false);
    if (error) { alert(error.message); return; }

    const row = (Array.isArray(data) && data[0]) || null;
    setRpt(row as Report | null);
  };

  useEffect(() => {
    if (tenantId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const apply: React.FormEventHandler = (e) => {
    e.preventDefault();
    load();
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">
        <b>Credit Reports</b> — {brand}
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[760px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* Baris filter (Start–Finish + submit) */}
            <tr className="filters">
              <th className="text-left w-24">Start</th>
              <th className="text-left w-64">
                <input
                  type="date"
                  value={fStart}
                  onChange={(e) => setFStart(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </th>
              <th className="text-left w-24">Finish</th>
              <th className="text-left w-64">
                <input
                  type="date"
                  value={fFinish}
                  onChange={(e) => setFFinish(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </th>
              <th className="text-left w-24">Action</th>
              <th className="text-left w-32">
                <button onClick={apply} className="rounded bg-blue-600 text-white px-3 py-1">
                  submit
                </button>
              </th>
            </tr>

            <tr>
              <th className="text-left w-40">Label</th>
              <th className="text-left" colSpan={5}>Value</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr><td colSpan={6}>Loading…</td></tr>
            ) : !rpt ? (
              <tr><td colSpan={6}>No data</td></tr>
            ) : (
              <>
                <tr><td># DP</td><td colSpan={5}>{rpt.dp_count}</td></tr>
                <tr><td># WD</td><td colSpan={5}>{rpt.wd_count}</td></tr>
                <tr><td># Trx Total</td><td colSpan={5}>{rpt.trx_total}</td></tr>
                <tr><td>Credit Bonus</td><td colSpan={5}>{formatAmount(rpt.credit_bonus)}</td></tr>
                <tr><td>Credit In</td><td colSpan={5}>{formatAmount(rpt.credit_in)}</td></tr>
                <tr><td>Credit Out</td><td colSpan={5}>{formatAmount(rpt.credit_out)}</td></tr>
                <tr><td>Credit Balance</td><td colSpan={5}>{formatAmount(rpt.credit_balance)}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
