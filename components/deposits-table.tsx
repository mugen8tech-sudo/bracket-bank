"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  direct_fee_percent: number;
  balance: number;
};

type LeadLite = {
  id: number;
  username: string | null;
  name: string | null;
  bank: string | null;
  bank_name: string | null;
  bank_no: string | null;
};

const BANK_CODES = [
  "BCA","BRI","BNI","MANDIRI","BSI","CIMB","PERMATA",
  "SEABANK","JAGO","DANA","OVO","GOPAY","SHOPEEPAY",
  "LINKAJA","SAKUKU","OTHER"
];

function parseNumberFromInput(s: string) {
  // hilangkan pemisah ribuan & karakter non angka/decimal
  const cleaned = s.replace(/,/g, "").replace(/[^\d.]/g, "");
  // jaga hanya satu titik desimal dan max 2 desimal saat ketik
  const parts = cleaned.split(".");
  const integer = parts[0] ?? "0";
  const frac = parts[1] ? parts[1].slice(0, 2) : "";
  return frac ? `${integer}.${frac}` : integer;
}

function toNumber(s: string) {
  const n = Number((s || "0").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function nowLocalDatetimeValue() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BanksTable() {
  const supabase = supabaseBrowser();

  const [rows, setRows] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantName, setTenantName] = useState<string>("");
  const [tenantCredit, setTenantCredit] = useState<number>(0);

  // ====== setting potongan langsung -> dampak credit tenant ======
  const [showSetting, setShowSetting] = useState(false);
  const [hitCredit, setHitCredit] = useState<boolean>(true);

  // ====== DP modal state ======
  const [showDP, setShowDP] = useState(false);
  const [dpBank, setDpBank] = useState<BankRow | null>(null);
  const [dpOpenedISO, setDpOpenedISO] = useState<string>("");
  const [dpTxnFinal, setDpTxnFinal] = useState<string>(nowLocalDatetimeValue());
  const [dpAmountStr, setDpAmountStr] = useState<string>("0.00");
  const [dpPromo, setDpPromo] = useState<string>("");
  const [dpDesc, setDpDesc] = useState<string>("");

  // player search states
  const [leadQuery, setLeadQuery] = useState<string>("");
  const [leadOptions, setLeadOptions] = useState<LeadLite[]>([]);
  const [leadPicked, setLeadPicked] = useState<LeadLite | null>(null);
  const [leadIndex, setLeadIndex] = useState<number>(0); // index item yang di-highlight
  const playerInputRef = useRef<HTMLInputElement | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);

  const closeDP = useCallback(() => setShowDP(false), []);
  const openDPFor = (b: BankRow) => {
    setDpBank(b);
    setShowDP(true);
    setDpOpenedISO(new Date().toISOString());
    setDpTxnFinal(nowLocalDatetimeValue());
    setDpAmountStr("0.00"); // default
    setDpPromo("");
    setDpDesc("");
    setLeadQuery("");
    setLeadOptions([]);
    setLeadPicked(null);
    setLeadIndex(0);
  };

  // ESC close (DP & Setting)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showDP) closeDP();
        if (showSetting) setShowSetting(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showDP, showSetting, closeDP]);

  const load = async () => {
    setLoading(true);

    // tenant & credit
    const { data: { user} } = await supabase.auth.getUser();
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user?.id)
      .single();

    if (prof?.tenant_id) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, credit_balance")
        .eq("id", prof.tenant_id)
        .single();
      setTenantName(tenant?.name ?? "");
      setTenantCredit(tenant?.credit_balance ?? 0);

      // load setting potongan -> credit
      const { data: setting } = await supabase
        .from("tenant_settings")
        .select("bank_direct_fee_hits_credit")
        .eq("tenant_id", prof.tenant_id)
        .maybeSingle();
      setHitCredit(setting?.bank_direct_fee_hits_credit ?? true);
    }

    // banks
    const { data, error } = await supabase
      .from("banks")
      .select("*")
      .order("id", { ascending: false });

    setLoading(false);
    if (error) alert(error.message);
    else setRows((data as BankRow[]) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // cari lead by username
  useEffect(() => {
    let active = true;
    (async () => {
      if (!showDP) return;
      const q = leadQuery.trim();
      if (!q) { setLeadOptions([]); return; }
      const { data, error } = await supabase
        .from("leads")
        .select("id, username, name, bank, bank_name, bank_no")
        .ilike("username", `%${q}%`)
        .limit(10);
      if (!active) return;
      if (error) { console.error(error); return; }
      setLeadOptions((data as LeadLite[]) ?? []);
      setLeadIndex(0); // reset highlight ke item pertama
    })();
    return () => { active = false; };
  }, [leadQuery, showDP, supabase]);

  const submitDP = async () => {
    if (!dpBank) return;
    if (!leadPicked || !leadPicked.username) {
      alert("Pilih Player (username) lebih dulu.");
      // fokuskan kembali ke input player
      playerInputRef.current?.focus();
      return;
    }

    const gross = toNumber(dpAmountStr);
    if (!(gross > 0)) {
      alert("Amount harus lebih dari 0.");
      amountInputRef.current?.focus();
      return;
    }

    // parse datetime-local ke ISO
    const txnFinalISO = new Date(dpTxnFinal).toISOString();

    const { error } = await supabase.rpc("perform_deposit", {
      p_bank_id: dpBank.id,
      p_lead_id: leadPicked.id,
      p_username: leadPicked.username,
      p_amount_gross: gross,
      p_txn_at_opened: dpOpenedISO,
      p_txn_at_final: txnFinalISO,
      p_promo_code: dpPromo || null,
      p_description: dpDesc || null
    });

    if (error) {
      alert(error.message);
      return;
    }
    closeDP();
    await load();
  };

  const saveSetting = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof, error: e1 } = await supabase
      .from("profiles").select("tenant_id").eq("user_id", user?.id).single();
    if (e1) { alert(e1.message); return; }
    const { error } = await supabase
      .from("tenant_settings")
      .upsert({
        tenant_id: prof?.tenant_id,
        bank_direct_fee_hits_credit: hitCredit,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null
      });
    if (error) { alert(error.message); return; }
    setShowSetting(false);
  };

  // tombol placeholder (WD/PDP/TT/Adj/Biaya)
  const DisabledBtn = ({ label, title }: { label: string; title: string }) => (
    <button className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white opacity-70 cursor-not-allowed" title={title} disabled>
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {/* Setting ON/OFF potongan -> credit */}
        <button
          type="button"
          onClick={() => setShowSetting(true)}
          className="rounded bg-gray-100 px-4 py-2"
          title="Pengaturan dampak potongan langsung ke credit tenant"
        >
          Setting Potongan → Credit
        </button>
        <button
          type="button"
          onClick={() => { const evt = new CustomEvent("open-bank-new"); document.dispatchEvent(evt); }}
          className="rounded bg-green-600 text-white px-4 py-2"
        >
          New Record
        </button>
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid banks-grid min-w-[1000px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="text-left w-16">ID</th>
              <th className="text-left min-w-[260px]">Bank</th>
              <th className="text-center w-44">Website</th>
              <th className="text-center w-48">Balance</th>
              <th className="text-center w-64">Player Action</th>
              <th className="text-center w-64">CS Action</th>
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
                    <td className="text-center">{tenantName || "-"}</td>
                    <td className="text-center">{formatAmount(r.balance)}</td>
                    <td className="text-center">
                      <div className="inline-flex items-center gap-2">
                        <button
                          className="h-8 min-w-[52px] px-3 rounded bg-blue-600 text-white"
                          title="Buat deposit (DP)"
                          onClick={() => openDPFor(r)}
                        >
                          DP
                        </button>
                        <DisabledBtn label="WD" title="WD (coming soon)" />
                        <DisabledBtn label="PDP" title="PDP (coming soon)" />
                      </div>
                    </td>
                    <td className="text-center">
                      <div className="inline-flex items-center gap-2">
                        <DisabledBtn label="TT"  title="TT (coming soon)" />
                        <DisabledBtn label="Adj" title="Adjustment (coming soon)" />
                        <DisabledBtn label="Biaya" title="Biaya (coming soon)" />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* =========== Modal Setting Potongan → Credit =========== */}
      {showSetting && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => { if (e.currentTarget === e.target) setShowSetting(false); }}
        >
          <div className="bg-white rounded border w-full max-w-md mt-10">
            <div className="p-4 border-b font-semibold">Potongan Langsung → Credit Tenant</div>
            <div className="p-4 space-y-3 text-sm">
              <div>
                Atur <b>dampak potongan langsung</b> terhadap <b>credit tenant</b> saat <b>Deposit</b>:
              </div>
              <div className="flex items-center gap-2">
                <input id="hitcredit" type="checkbox" checked={hitCredit} onChange={(e)=>setHitCredit(e.target.checked)} />
                <label htmlFor="hitcredit">
                  <b>ON</b> = credit dikurangi <b>NET</b>. &nbsp;Matikan (OFF) = credit dikurangi <b>GROSS</b>.
                </label>
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button onClick={()=>setShowSetting(false)} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button onClick={saveSetting} className="rounded px-4 py-2 bg-blue-600 text-white">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* =========== Modal DP =========== */}
      {showDP && dpBank && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e)=>{ if (e.currentTarget === e.target) closeDP(); }}
        >
          <form
            onSubmit={(e)=>{ e.preventDefault(); submitDP(); }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b">
              <div className="font-semibold">
                Deposit to [{dpBank.bank_code}] {dpBank.account_name} - {dpBank.account_no}
              </div>
              <div className="text-xs mt-1">
                Balance (Credit Tenant): <b>{formatAmount(tenantCredit)}</b>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Player search */}
              <div>
                <label className="block text-xs mb-1">Player</label>
                <div className="relative">
                  <input
                    ref={playerInputRef}
                    className="border rounded px-3 py-2 w-full"
                    placeholder="search username"
                    value={leadPicked ? (leadPicked.username ?? "") : leadQuery}
                    onChange={(e)=>{ setLeadPicked(null); setLeadQuery(e.target.value); }}
                    onKeyDown={(e) => {
                      if (!leadPicked && leadOptions.length > 0) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setLeadIndex((i) => Math.min(i + 1, leadOptions.length - 1));
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setLeadIndex((i) => Math.max(i - 1, 0));
                          return;
                        }
                        if (e.key === "Enter") {
                          // Enter pertama -> pilih player yang di-highlight
                          e.preventDefault();
                          const pick = leadOptions[Math.max(0, leadIndex)];
                          if (pick) {
                            setLeadPicked(pick);
                            setLeadOptions([]);
                          }
                          return;
                        }
                      }
                      // Jika dropdown tidak terbuka / sudah pilih player,
                      // biarkan Enter men-trigger submit form (onSubmit di form).
                    }}
                  />
                  {/* dropdown */}
                  {!leadPicked && leadOptions.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-56 overflow-auto w-full border bg-white rounded shadow">
                      {leadOptions.map((opt, idx) => (
                        <div
                          key={opt.id}
                          onClick={()=>{ setLeadPicked(opt); setLeadOptions([]); }}
                          className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-100 ${idx===leadIndex ? "bg-blue-50" : ""}`}
                        >
                          {opt.username} ({opt.bank ?? opt.bank_name} | {opt.name} | {opt.bank_no})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs mb-1">Amount</label>
                <input
                  ref={amountInputRef}
                  className="border rounded px-3 py-2 w-full"
                  value={dpAmountStr}
                  onFocus={(e)=> e.currentTarget.select()}  // auto select all
                  onChange={(e)=>{
                    const cleaned = parseNumberFromInput(e.target.value);
                    setDpAmountStr(cleaned);
                  }}
                  onBlur={()=>{
                    const n = toNumber(dpAmountStr);
                    setDpAmountStr(
                      new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
                    );
                  }}
                />
              </div>

              {/* Transaction Date */}
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  className="border rounded px-3 py-2 w-full"
                  value={dpTxnFinal}
                  onChange={(e)=>setDpTxnFinal(e.target.value)}
                />
              </div>

              {/* Promo Code (tidak dipakai) */}
              <div>
                <label className="block text-xs mb-1">Promo Code</label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  value={dpPromo}
                  onChange={(e)=>setDpPromo(e.target.value)}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  rows={3}
                  className="border rounded px-3 py-2 w-full"
                  value={dpDesc}
                  onChange={(e)=>setDpDesc(e.target.value)}
                />
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={closeDP} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button type="submit" className="rounded px-4 py-2 bg-blue-600 text-white">Submit</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
