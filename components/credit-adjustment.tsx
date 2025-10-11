"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/* ===== Roles (konsisten dengan Sidebar) ===== */
type Role = "admin" | "cs" | "viewer" | "other";
const normalizeRole = (r?: string | null): Role => {
  const v = (r || "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "cs" || v === "assops") return "cs";
  if (v === "viewer" || v === "agent") return "viewer";
  return "other";
};

/* ===== Amount helpers (adopsi Banks: live grouping + signed) ===== */
function normalizeMinus(raw: string) {
  return raw.replace(/\u2212|\u2013|\u2014/g, "-");
}
function formatWithGroupingLive(raw: string) {
  let cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) +
      cleaned.slice(firstDot + 1).replace(/\./g, "");
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
function formatWithGroupingLiveSigned(raw: string) {
  let s = normalizeMinus(raw.trim());
  const isNeg = s.startsWith("-") || s.endsWith("-");
  s = s.replace(/-/g, "");
  const grouped = formatWithGroupingLive(s);
  return (isNeg ? "-" : "") + grouped;
}
function toNumber(input: string) {
  let c = (input || "0").replace(/,/g, "");
  if (c.endsWith(".")) c = c.slice(0, -1);
  const n = Number(c);
  return isNaN(n) ? 0 : n;
}
function toNumberSigned(input: string) {
  let s = normalizeMinus(input.trim());
  const isNeg = s.startsWith("-") || s.endsWith("-");
  s = s.replace(/-/g, "");
  const n = toNumber(s);
  return isNeg ? -n : n;
}

/* ===== Date helpers ===== */
const toInputLocal = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const startIsoJakarta = (d: string) => (d ? new Date(`${d}T00:00:00+07:00`).toISOString() : null);
const endIsoJakarta = (d: string) => (d ? new Date(`${d}T23:59:59.999+07:00`).toISOString() : null);

/* ===== Types ===== */
type Row = {
  id: number;
  tenant_id: string;
  delta_credit: number;
  description: string | null;
  is_bonus: boolean;
  created_at: string;
  created_by: string | null;
};

const PAGE_SIZE = 25;

export default function CreditAdjustment() {
  const supabase = supabaseBrowser();

  /* tenant & role */
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [brand, setBrand] = useState("TECH");
  const [role, setRole] = useState<Role>("other");
  const [booting, setBooting] = useState(true);

  /* data */
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameBy, setNameBy] = useState<Record<string, string>>({});
  const [totalAmount, setTotalAmount] = useState<number>(0);

  /* pagination */
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const goFirst = () => canPrev && load(1);
  const goPrev = () => canPrev && load(page - 1);
  const goNext = () => canNext && load(page + 1);
  const goLast = () => canNext && load(totalPages);
  const getPageList = () => {
    const list: (number | "truncate")[] = [];
    if (totalPages <= 10) { for (let i=1;i<=totalPages;i++) list.push(i); return list; }
    if (page <= 6) return [1,2,3,4,5,6,"truncate", totalPages];
    if (page >= totalPages - 5) { list.push(1,"truncate"); for (let i=totalPages-5;i<=totalPages;i++) list.push(i); return list; }
    return [1,"truncate",page-1,page,page+1,"truncate",totalPages];
  };

  /* filters */
  const [fStart, setFStart] = useState<string>("");   // yyyy-mm-dd
  const [fFinish, setFFinish] = useState<string>("");
  const [fBonus, setFBonus] = useState<"all"|"true"|"false">("all");

  /* modal */
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [amountStr, setAmountStr] = useState("0.00");
  const [trxAt, setTrxAt] = useState(toInputLocal(new Date()));
  const [description, setDescription] = useState("");
  const [isBonus, setIsBonus] = useState(true); // default tercentang
  const amountRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = useMemo(
    () => (role === "admin" || role === "cs") && !submitting,
    [role, submitting]
  );

  /* bootstrap: tenant + role */
  useEffect(() => {
    (async () => {
      setBooting(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setBooting(false); return; }

      const { data: prof } = await supabase
        .from("profiles")
        .select("role, tenant_id")
        .eq("user_id", user.id)
        .single();

      setRole(normalizeRole(prof?.role));
      if (prof?.tenant_id) {
        setTenantId(prof.tenant_id);
        const { data: tenant } = await supabase
          .from("tenants")
          .select("slug, name")
          .eq("id", prof.tenant_id)
          .single();
        setBrand(tenant?.slug || tenant?.name || "—");
      }
      setBooting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* query builder */
  const buildQuery = () => {
    let q = supabase
      .from("tenant_ledger")
      .select("id, tenant_id, delta_credit, description, is_bonus, created_at, created_by", { count: "exact" })
      .eq("ref_type", "credit_adjustment")
      .order("created_at", { ascending: false });

    if (tenantId) q = q.eq("tenant_id", tenantId);
    const s = startIsoJakarta(fStart); if (s) q = q.gte("created_at", s);
    const e = endIsoJakarta(fFinish);  if (e) q = q.lte("created_at", e);
    if (fBonus !== "all") q = q.eq("is_bonus", fBonus === "true");

    return q;
  };

  /* load rows */
  const load = async (pageToLoad: number = page) => {
    if (!tenantId) return;
    setLoading(true);
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    const { data, error, count } = await buildQuery().range(from, to);
    setLoading(false);
    if (error) { alert(error.message); return; }

    const list = (data as Row[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);

    // ambil nama "By"
    const ids = [
      ...new Set(
        list
          .map(r => r.created_by)
          .filter((v): v is string => typeof v === "string" && v.length > 0)
      ),
    ];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      const map: Record<string,string> = {};
      (profs ?? []).forEach((p:any) => { map[p.user_id] = p.full_name || p.user_id; });
      setNameBy(map);
    } else {
      setNameBy({});
    }
  };

  /* load total */
  const loadTotal = async () => {
    if (!tenantId) return;
    const { data, error } = await supabase.rpc("get_credit_adjustment_total", {
      p_start: startIsoJakarta(fStart),
      p_finish: endIsoJakarta(fFinish),
      p_is_bonus: fBonus === "all" ? null : fBonus === "true",
    });
    if (error) { console.error(error); return; }
    setTotalAmount(Number(data ?? 0));
  };

  /* apply filter */
  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1);
    loadTotal();
  };

  /* initial load after tenant resolved */
  useEffect(() => {
    if (tenantId) { load(1); loadTotal(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  /* modal handlers */
  const openNew = () => {
    if (role !== "admin" && role !== "cs") {
      alert("Hanya Admin & CS yang bisa melakukan Credit Adjustment.");
      return;
    }
    setAmountStr("0.00");
    setTrxAt(toInputLocal(new Date()));
    setDescription("");
    setIsBonus(true);
    setShowForm(true);
    setTimeout(() => amountRef.current?.select(), 0);
  };
  const closeModal = useCallback(() => setShowForm(false), []);
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeModal();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm, closeModal]);

  /* submit */
  const submitAdjustment = async () => {
    if (role !== "admin" && role !== "cs") {
      alert("Hanya Admin & CS yang bisa melakukan Credit Adjustment.");
      return;
    }
    const delta = toNumberSigned(amountStr);
    if (delta === 0) {
      alert("Amount tidak boleh 0.");
      amountRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("perform_tenant_credit_adjustment", {
        p_delta: delta,
        p_txn_at: new Date(trxAt).toISOString(),
        p_description: description || null,
        p_is_bonus: isBonus,
      });
      if (error) { alert(error.message); return; }

      await load(1);
      await loadTotal();
      setShowForm(false);
      alert("Credit Adjustment berhasil disimpan.");
    } finally {
      setSubmitting(false);
    }
  };

  /* UI */
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Credit Adjustments — {brand} &nbsp;|&nbsp;
          <b>{formatAmount(totalAmount)}</b>
        </div>
        <button
          type="button"
          onClick={openNew}
          disabled={booting || !(role === "admin" || role === "cs")}
          className="rounded bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
          title={
            booting
              ? "Memuat…"
              : role === "admin" || role === "cs"
              ? "New Credit Adjustment"
              : "Hanya Admin & CS"
          }
        >
          New Credit Adjustment
        </button>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1000px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* Row FILTERS (di atas header) */}
            <tr className="filters">
              <th /> {/* ID: tidak ada filter */}
              <th /> {/* Amount: tidak ada filter */}
              <th /> {/* Description: tidak ada filter */}
              <th>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={fBonus}
                  onChange={(e) => setFBonus(e.target.value as any)}
                >
                  <option value="all">All</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </th>
              <th>
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e) => setFStart(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Start date"
                  />
                  <input
                    type="date"
                    value={fFinish}
                    onChange={(e) => setFFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Finish date"
                  />
                </div>
              </th>
              <th className="whitespace-nowrap">
                <button
                  onClick={applyFilters}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  submit
                </button>
              </th>
            </tr>

            {/* Row HEADER */}
            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left w-48">Amount</th>
              <th className="text-left min-w-[340px]">Description</th>
              <th className="text-left w-28">Is Bonus</th>
              <th className="text-left w-56">Tgl</th>
              <th className="text-left w-48">By</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr><td colSpan={6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6}>No data</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.id}</td>
                  <td>{formatAmount(r.delta_credit)}</td>
                  <td className="whitespace-normal break-words min-w-[340px]">{r.description ?? "-"}</td>
                  <td>{String(r.is_bonus)}</td>
                  <td>
                    {new Date(r.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                  </td>
                  <td>{r.created_by ? (nameBy[r.created_by] ?? r.created_by) : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button onClick={goFirst} disabled={!canPrev} className="px-3 py-1 rounded border bg-white disabled:opacity-50">First</button>
          <button onClick={goPrev}  disabled={!canPrev} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Previous</button>

          {getPageList().map((it, idx) =>
            typeof it === "number" ? (
              <button
                key={`p-${it}`}
                onClick={() => load(it)}
                className={`px-3 py-1 rounded border ${page === it ? "bg-blue-600 text-white" : "bg-white"}`}
              >
                {it}
              </button>
            ) : (
              <span key={`t-${idx}`} className="px-3 py-1 rounded border bg-white text-gray-500">Truncate</span>
            )
          )}

          <button onClick={goNext} disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={goLast} disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>

      {/* Modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => { if (e.currentTarget === e.target) closeModal(); }}
        >
          <form
            onSubmit={(e) => { e.preventDefault(); submitAdjustment(); }}
            className="bg-white rounded border w-full max-w-xl mt-10"
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold">New Credit Adjustment — {brand}</div>
              <button type="button" onClick={closeModal} className="text-sm" aria-label="Close">✕</button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Amount (+/−)</label>
                <input
                  ref={amountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={amountStr}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const f = formatWithGroupingLiveSigned(e.target.value);
                    setAmountStr(f);
                    setTimeout(() => { const el = amountRef.current; if (el) { const L = el.value.length; el.setSelectionRange(L,L); } }, 0);
                  }}
                  onBlur={() => {
                    const n = toNumberSigned(amountStr);
                    setAmountStr(new Intl.NumberFormat("en-US",{ minimumFractionDigits:2, maximumFractionDigits:2 }).format(n));
                  }}
                  placeholder="1,000.00 / -1,000.00"
                  required
                />
              </div>

              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  step="1"
                  className="border rounded px-3 py-2 w-full"
                  value={trxAt}
                  onChange={(e) => setTrxAt(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  className="border rounded px-3 py-2 w-full min-h-[90px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2">
                <input id="is_bonus" type="checkbox" checked={isBonus} onChange={(e) => setIsBonus(e.target.checked)} />
                <label htmlFor="is_bonus">Bonus?</label>
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={closeModal} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button type="submit" disabled={!canSubmit} className="rounded px-4 py-2 bg-blue-600 text-white disabled:opacity-50">
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
