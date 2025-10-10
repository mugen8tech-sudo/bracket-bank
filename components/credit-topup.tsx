"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type LedgerRow = {
  id: number;
  tenant_id: string;
  amount: number;
  description: string | null;
  txn_at: string | null;      // timestamptz
  created_at: string | null;  // timestamptz
  created_by: string | null;  // uuid (user_id)
  entry_code: string | null;  // mis. 'CREDIT_TOPUP'
};

type ProfileLite = { user_id: string; full_name: string | null };

const LEDGER_TOPUP_CODE = "CREDIT_TOPUP"; // ganti jika kodenya berbeda

// ===== Helpers input amount (pola sama seperti di banks-table.tsx) =====
function formatWithGroupingLive(raw: string) {
  let cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  }
  let [intPart = "0", fracPartRaw] = cleaned.split(".");
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "") intPart = "0";
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fracPartRaw !== undefined) {
    const frac = fracPartRaw.slice(0, 2);
    return fracPartRaw.length === 0 ? intGrouped + "." : intGrouped + "." + frac;
  }
  return intGrouped;
}
function toNumber(input: string) {
  let c = (input || "0").replace(/,/g, "");
  if (c.endsWith(".")) c = c.slice(0, -1);
  const n = Number(c);
  return isNaN(n) ? 0 : n;
}
function nowLocalDatetimeValue() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function CreditTopup() {
  const supabase = supabaseBrowser();

  // guard role
  const [role, setRole] = useState<"admin" | "cs" | "viewer" | "other" | "loading">("loading");
  const canCreate = role === "admin" || role === "cs";

  // tenant info (Website/Credit) — persis pola di Banks
  const [tenantName, setTenantName] = useState<string>("");
  const [tenantCredit, setTenantCredit] = useState<number>(0);
  const [tenantId, setTenantId] = useState<string>("");

  // list topup
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [byMap, setByMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // modal
  const [showNew, setShowNew] = useState(false);
  const [amountStr, setAmountStr] = useState("0.00");
  const [txnAt, setTxnAt] = useState(nowLocalDatetimeValue());
  const [desc, setDesc] = useState("");

  // ===== initial load: role + tenant name & credit + list
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setRole("other"); return; }

      // role & tenant id
      const { data: prof } = await supabase
        .from("profiles")
        .select("role, tenant_id, full_name")
        .eq("user_id", user.id)
        .single();

      const r = (prof?.role ?? "") as string;
      setRole(r === "admin" ? "admin" : r === "cs" || r === "assops" ? "cs" : r === "viewer" ? "viewer" : "other");
      if (!prof?.tenant_id) return;
      setTenantId(prof.tenant_id);

      // tenant info (nama & credit)
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, credit_balance")
        .eq("id", prof.tenant_id)
        .single();
      setTenantName(tenant?.name ?? "");
      setTenantCredit(tenant?.credit_balance ?? 0);

      await loadList(prof.tenant_id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadList(tid: string) {
    setLoading(true);
    // Ambil ledger topup tenant ini
    let { data, error } = await supabase
      .from("tenant_ledger")
      .select("id, tenant_id, amount, description, txn_at, created_at, created_by, entry_code")
      .eq("tenant_id", tid)
      .eq("entry_code", LEDGER_TOPUP_CODE)
      .order("id", { ascending: false });

    // fallback kalau kolom/entry_code belum ada → tampilkan semua positif (opsional)
    if (error) {
      const alt = await supabase
        .from("tenant_ledger")
        .select("id, tenant_id, amount, description, txn_at, created_at, created_by, entry_code")
        .eq("tenant_id", tid)
        .gt("amount", 0)
        .order("id", { ascending: false });
      data = alt.data;
    }

    setRows((data as LedgerRow[]) ?? []);
    setLoading(false);

    // map "By"
    const ids = Array.from(new Set(((data as LedgerRow[]) ?? []).map(r => r.created_by).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      const map: Record<string, string> = {};
      (profs as ProfileLite[] || []).forEach(p => { map[p.user_id] = p.full_name || ""; });
      setByMap(map);
    } else {
      setByMap({});
    }
  }

  // submit topup → RPC (lebih aman ketimbang UPDATE langsung saat RLS aktif)
  async function submitTopup(e: React.FormEvent) {
    e.preventDefault();
    const n = toNumber(amountStr);
    if (!(n > 0)) { alert("Amount harus > 0"); return; }

    const { error } = await supabase.rpc("perform_tenant_credit_topup", {
      p_amount: n,
      p_txn_at: new Date(txnAt).toISOString(),
      p_description: desc || null,
    });

    if (error) {
      alert(error.message + "\n\nPastikan function perform_tenant_credit_topup sudah dibuat (lihat SQL di bawah).");
      return;
    }

    setShowNew(false);
    setAmountStr("0.00");
    setTxnAt(nowLocalDatetimeValue());
    setDesc("");

    // refresh credit & list
    const { data: tenant } = await supabase
      .from("tenants")
      .select("credit_balance")
      .eq("id", tenantId)
      .single();
    setTenantCredit(tenant?.credit_balance ?? 0);
    await loadList(tenantId);
  }

  const totalTopup = useMemo(
    () => rows.reduce((s, r) => s + (r.amount || 0), 0),
    [rows]
  );

  if (role === "loading") {
    return <div className="p-6">Loading…</div>;
  }

  return (
    <div className="space-y-3">
      {/* Header ringkasan */}
      <div className="text-lg font-semibold">
        Credit Topup — <span className="font-normal">{tenantName || "-"}</span>
      </div>
      <div className="text-sm">
        Credit Balance: <b>{formatAmount(tenantCredit)}</b>
        <span className="mx-2">•</span>
        Total Topup (list ini): <b>{formatAmount(totalTopup)}</b>
      </div>

      {/* Action */}
      <div className="flex items-center justify-end">
        {canCreate && (
          <button
            className="rounded bg-blue-600 text-white px-4 py-2"
            onClick={() => { setShowNew(true); }}
          >
            New Credit TopUp
          </button>
        )}
      </div>

      {/* Tabel */}
      <div className="overflow-auto rounded border bg-white">
        <table className="min-w-[900px]" style={{ borderCollapse: "collapse" }}>
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 border w-24">ID</th>
              <th className="text-right p-2 border w-40">Amount</th>
              <th className="text-left p-2 border">Description</th>
              <th className="text-left p-2 border w-40">Tgl</th>
              <th className="text-left p-2 border w-40">By</th>
              {/* Tidak ada kolom Action / Detail */}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-3" colSpan={5}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-3" colSpan={5}>No data</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="p-2 border">{r.id}</td>
                  <td className="p-2 border text-right">{formatAmount(r.amount || 0)}</td>
                  <td className="p-2 border">{r.description || "-"}</td>
                  <td className="p-2 border">
                    {r.txn_at
                      ? new Date(r.txn_at).toLocaleString()
                      : (r.created_at ? new Date(r.created_at).toLocaleString() : "-")}
                  </td>
                  <td className="p-2 border">
                    {r.created_by ? (byMap[r.created_by] || r.created_by.slice(0, 8)) : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal New */}
      {showNew && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e)=>{ if(e.currentTarget===e.target) setShowNew(false); }}
        >
          <form onSubmit={submitTopup} className="bg-white rounded border w-full max-w-2xl mt-10">
            <div className="p-4 border-b font-semibold">Credit Topup di [{tenantName || "Tenant"}]</div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Amount</label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  value={amountStr}
                  onFocus={(e)=>e.currentTarget.select()}
                  onChange={(e)=>{
                    const f = formatWithGroupingLive(e.target.value);
                    setAmountStr(f);
                    setTimeout(()=>{
                      const el = e.currentTarget;
                      const L = el.value.length;
                      el.setSelectionRange(L, L);
                    }, 0);
                  }}
                  onBlur={()=>{
                    const n = toNumber(amountStr);
                    setAmountStr(new Intl.NumberFormat("en-US",{ minimumFractionDigits:2, maximumFractionDigits:2 }).format(n));
                  }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={txnAt}
                  onChange={(e)=>setTxnAt(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea rows={3} className="border rounded px-3 py-2 w-full" value={desc} onChange={(e)=>setDesc(e.target.value)} />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowNew(false)} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button className="rounded px-4 py-2 bg-blue-600 text-white">Submit</button>
            </div>
          </form>
        </div>
      )}

      {/* Info untuk viewer */}
      {role === "viewer" && (
        <div className="text-xs text-gray-500">
          Mode viewer: hanya bisa melihat data, tidak bisa input.
        </div>
      )}
    </div>
  );
}
