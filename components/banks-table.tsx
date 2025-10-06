"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type BankRow = {
  id: number;
  tenant_id: string;
  bank_code: string;
  account_name: string;
  account_no: string;
  usage_type: "deposit" | "withdraw" | "neutral";
  is_active: boolean;
  is_pulsa: boolean;
  direct_fee_enabled: boolean;
  direct_fee_percent: string | number;
  balance: string | number;
};

const BANK_CODES = [
  "BCA","BRI","BNI","MANDIRI","BSI","CIMB","PERMATA",
  "SEABANK","JAGO","DANA","OVO","GOPAY","SHOPEEPAY",
  "LINKAJA","SAKUKU","OTHER"
];

export default function BanksTable() {
  const supabase = supabaseBrowser();

  const [rows, setRows] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantName, setTenantName] = useState<string>("");

  // ===== modal state =====
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    bank_code: "BCA",
    account_name: "",
    account_no: "",
    is_pulsa: false,
    direct_fee_enabled: false,
    direct_fee_percent: "0.00",
  });

  const closeModal = useCallback(() => setShowForm(false), []);
  const openModal = () => setShowForm(true);

  // close modal via ESC
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm, closeModal]);

  const load = async () => {
    setLoading(true);

    // Ambil tenant untuk label Website
    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof } = await supabase.from("profiles")
      .select("tenant_id").eq("user_id", user?.id).single();

    if (prof?.tenant_id) {
      const { data: tenant } = await supabase
        .from("tenants").select("name").eq("id", prof.tenant_id).single();
      setTenantName(tenant?.name ?? "");
    }

    // Ambil seluruh bank milik tenant (tanpa pagination)
    const { data, error } = await supabase
      .from("banks")
      .select("*")
      .order("id", { ascending: false });

    setLoading(false);
    if (error) {
      alert(error.message);
    } else {
      setRows((data as BankRow[]) ?? []);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    // Validasi
    if (!form.account_name.trim()) { alert("Nama rekening wajib diisi."); return; }
    if (!form.account_no.trim())   { alert("No rekening wajib diisi."); return; }
    if (form.direct_fee_enabled) {
      const v = Number(form.direct_fee_percent);
      if (!(v > 0)) { alert("% potongan langsung harus > 0"); return; }
    }

    // tenant_id dari profile
    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof, error: eProf } = await supabase
      .from("profiles").select("tenant_id").eq("user_id", user?.id).single();
    if (eProf) { alert(eProf.message); return; }

    const payload = {
      tenant_id: prof?.tenant_id,
      bank_code: form.bank_code,
      account_name: form.account_name.trim(),
      account_no: form.account_no.trim(),
      is_pulsa: !!form.is_pulsa,
      direct_fee_enabled: !!form.direct_fee_enabled,
      direct_fee_percent: form.direct_fee_enabled ? Number(form.direct_fee_percent) : 0,
      usage_type: "neutral",   // default, dapat diubah nanti via Bank Management
      is_active: true,
      balance: 0
    };

    const { error } = await supabase.from("banks").insert(payload).select().single();
    if (error) { alert(error.message); return; }
    setShowForm(false);
    await load(); // refresh
  };

  // tombol placeholder
  const PlaceholderBtn = ({ label, title }: { label: string; title: string }) => (
    <button
      type="button"
      title={title}
      className="px-3 py-1 rounded bg-blue-600 text-white opacity-70 cursor-not-allowed"
      disabled
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={openModal}
          className="rounded bg-green-600 text-white px-4 py-2"
        >
          New Record
        </button>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1000px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="text-left w-16">ID</th>
              <th className="text-left min-w-[320px]">Bank</th>
              <th className="text-left w-40">Website</th>
              <th className="text-left w-40">Balance</th>
              <th className="text-left w-56">Player Action</th>
              <th className="text-left w-48">CS Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6}>No data</td></tr>
            ) : (
              rows.map((r) => {
                const rowBg =
                  r.usage_type === "deposit" ? "bg-green-200"
                  : r.usage_type === "withdraw" ? "bg-red-200"
                  : "bg-white";
                return (
                  <tr key={r.id} className={`${rowBg}`}>
                    <td>{r.id}</td>
                    <td className="whitespace-normal break-words">
                      <div className="font-semibold">
                        [{r.bank_code}] {r.account_name}
                      </div>
                      <div className="text-xs">{r.account_no}</div>
                    </td>
                    <td>{tenantName || "-"}</td>
                    <td>{formatAmount(r.balance)}</td>
                    <td>
                      <div className="flex gap-2">
                        <PlaceholderBtn label="DP"  title="DP (coming soon)" />
                        <PlaceholderBtn label="WD"  title="WD (coming soon)" />
                        <PlaceholderBtn label="PDP" title="PDP (coming soon)" />
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <PlaceholderBtn label="TT"   title="TT (coming soon)" />
                        <PlaceholderBtn label="Adj"  title="Adjustment (coming soon)" />
                        <PlaceholderBtn label="Biaya" title="Biaya (coming soon)" />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Modal New Record ===== */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => { if (e.currentTarget === e.target) closeModal(); }}
        >
          <form
            onSubmit={(e) => { e.preventDefault(); save(); }}
            className="bg-white rounded border w-full max-w-xl mt-10"
          >
            <div className="p-4 border-b font-semibold">Buat Bank Baru</div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Bank Provider</label>
                <select
                  value={form.bank_code}
                  onChange={(e)=>setForm(s=>({ ...s, bank_code: e.target.value }))}
                  className="border rounded px-3 py-2 w-full"
                >
                  {BANK_CODES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs mb-1">Nama rekening</label>
                <input
                  value={form.account_name}
                  onChange={(e)=>setForm(s=>({ ...s, account_name: e.target.value }))}
                  className="border rounded px-3 py-2 w-full"
                />
              </div>

              <div>
                <label className="block text-xs mb-1">No rekening</label>
                <input
                  value={form.account_no}
                  onChange={(e)=>setForm(s=>({ ...s, account_no: e.target.value }))}
                  className="border rounded px-3 py-2 w-full"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="pulsa"
                  type="checkbox"
                  checked={form.is_pulsa}
                  onChange={(e)=>setForm(s=>({ ...s, is_pulsa: e.target.checked }))}
                />
                <label htmlFor="pulsa" className="text-sm">Is Pulsa?</label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="directfee"
                  type="checkbox"
                  checked={form.direct_fee_enabled}
                  onChange={(e)=>setForm(s=>({ ...s, direct_fee_enabled: e.target.checked }))}
                />
                <label htmlFor="directfee" className="text-sm">Potongan Langsung?</label>
              </div>

              <div>
                <label className="block text-xs mb-1">% potongan langsung</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.direct_fee_percent}
                  onChange={(e)=>setForm(s=>({ ...s, direct_fee_percent: e.target.value }))}
                  className="border rounded px-3 py-2 w-full"
                  disabled={!form.direct_fee_enabled}
                />
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={closeModal} className="rounded px-4 py-2 bg-gray-100">
                Close
              </button>
              <button type="submit" className="rounded px-4 py-2 bg-blue-600 text-white">
                Submit
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
