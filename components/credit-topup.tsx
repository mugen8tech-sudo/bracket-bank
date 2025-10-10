"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

/** ================= Roles (konsisten dgn Sidebar) ================= */
type AppRole = "admin" | "cs" | "viewer" | "other";
const normalizeRole = (r?: string | null): AppRole => {
  const v = (r || "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "cs" || v === "assops") return "cs";
  if (v === "viewer" || v === "agent") return "viewer";
  return "other";
};

/** ================= Currency & Date helpers ================= */
const nfID = new Intl.NumberFormat("id-ID");
const formatID = (n: number) => (Number.isFinite(n) ? nfID.format(n) : "");
const parseCurrency = (s: string) => {
  // ambil angka & tanda minus/plus saja, buang pemisah ribuan & simbol
  const cleaned = s.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : NaN;
};

// yyyy-MM-ddTHH:mm untuk <input type="datetime-local">
const toInputLocal = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

// helper filter tanggal lokal Jakarta -> ISO UTC
const startIsoJakarta = (d: string) => new Date(`${d}T00:00:00+07:00`).toISOString();
const endIsoJakarta = (d: string) => new Date(`${d}T23:59:59.999+07:00`).toISOString();

/** ================= Type & Const ================= */
type Topup = {
  id: number;
  tenant_id: string;
  delta_credit: number;
  note: string | null;
  created_at: string; // timestamptz
  created_by: string | null;
};

const PAGE_SIZE = 25;

/** ================= Component ================= */
export default function CreditTopup() {
  const supabase = supabaseBrowser();
  const router = useRouter();

  // ---------- Tenant & Role ----------
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [brand, setBrand] = useState<string>("TECH");
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [role, setRole] = useState<AppRole>("other");
  const [bootLoading, setBootLoading] = useState(true);

  // ---------- Data & Pagination ----------
  const [rows, setRows] = useState<Topup[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ---------- FILTERS (baris di atas header) ----------
  const [fId, setFId] = useState<string>("");
  const [fMin, setFMin] = useState<string>("");
  const [fMax, setFMax] = useState<string>("");
  const [fStart, setFStart] = useState<string>("");
  const [fFinish, setFFinish] = useState<string>("");
  const [fNote, setFNote] = useState<string>("");

  // ---------- Modal ----------
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [amountInput, setAmountInput] = useState<string>("");
  const [trxAtInput, setTrxAtInput] = useState<string>(toInputLocal(new Date()));
  const [description, setDescription] = useState<string>("");

  const canSubmit = useMemo(
    () => (role === "admin" || role === "cs") && !submitting,
    [role, submitting]
  );

  /** ================= Bootstrap (role + tenant + saldo) ================= */
  useEffect(() => {
    (async () => {
      setBootLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setBootLoading(false);
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("role, tenant_id")
        .eq("user_id", user.id)
        .single();

      const r = normalizeRole(prof?.role);
      setRole(r);
      if (prof?.tenant_id) {
        setTenantId(prof.tenant_id);

        const { data: tenant } = await supabase
          .from("tenants")
          .select("slug, name, credit_balance")
          .eq("id", prof.tenant_id)
          .single();

        setBrand(tenant?.slug || tenant?.name || "—");
        setCreditBalance(
          typeof tenant?.credit_balance === "number" ? tenant!.credit_balance : null
        );
      }
      setBootLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ================= Query builder (mirip Leads) ================= */
  const buildQuery = () => {
    let q = supabase
      .from("tenant_ledger")
      .select("id, tenant_id, delta_credit, note, created_at, created_by", {
        count: "exact",
      })
      .eq("ref_type", "credit_topup")
      .order("created_at", { ascending: false });

    if (tenantId) q = q.eq("tenant_id", tenantId);

    if (fId.trim()) {
      const asNum = Number(fId.trim());
      if (!Number.isNaN(asNum)) q = q.eq("id", asNum);
    }
    if (fMin.trim()) {
      const minVal = parseCurrency(fMin);
      if (Number.isFinite(minVal)) q = q.gte("delta_credit", minVal);
    }
    if (fMax.trim()) {
      const maxVal = parseCurrency(fMax);
      if (Number.isFinite(maxVal)) q = q.lte("delta_credit", maxVal);
    }
    if (fNote.trim()) q = q.ilike("note", `%${fNote.trim()}%`);
    if (fStart) q = q.gte("created_at", startIsoJakarta(fStart));
    if (fFinish) q = q.lte("created_at", endIsoJakarta(fFinish));

    return q;
  };

  /** ================= Loader ================= */
  const load = async (pageToLoad = page) => {
    setLoading(true);
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = buildQuery().range(from, to);

    const { data, error, count } = await q;
    setLoading(false);
    if (error) {
      alert(error.message);
    } else {
      setRows((data as Topup[]) ?? []);
      setTotal(count ?? 0);
      setPage(pageToLoad);
    }
  };

  // pertama kali setelah bootstrap selesai
  useEffect(() => {
    if (tenantId) load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1);
  };

  /** ================= Pagination controls (mirip Leads) ================= */
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const goFirst = () => canPrev && load(1);
  const goPrev = () => canPrev && load(page - 1);
  const goNext = () => canNext && load(page + 1);
  const goLast = () => canNext && load(totalPages);

  const getPageList = () => {
    const list: (number | "truncate")[] = [];
    if (totalPages <= 10) {
      for (let i = 1; i <= totalPages; i++) list.push(i);
      return list;
    }
    if (page <= 6) {
      list.push(1, 2, 3, 4, 5, 6, "truncate", totalPages);
      return list;
    }
    if (page >= totalPages - 5) {
      list.push(1, "truncate");
      for (let i = totalPages - 5; i <= totalPages; i++) list.push(i);
      return list;
    }
    list.push(1, "truncate", page - 1, page, page + 1, "truncate", totalPages);
    return list;
  };

  /** ================= Modal handlers ================= */
  const openNew = () => {
    if (role !== "admin" && role !== "cs") {
      alert("Hanya Admin & CS yang bisa melakukan Credit Topup.");
      return;
    }
    setAmountInput("");
    setTrxAtInput(toInputLocal(new Date()));
    setDescription("");
    setShowForm(true);
  };

  const closeModal = useCallback(() => setShowForm(false), []);
  // ESC to close
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeModal();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm, closeModal]);

  /** ================= Submit Topup ================= */
  const submitTopup = async () => {
    if (role !== "admin" && role !== "cs") {
      alert("Hanya Admin & CS yang bisa melakukan Credit Topup.");
      return;
    }

    const amount = parseCurrency(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Amount harus angka dan > 0.");
      return;
    }

    setSubmitting(true);
    try {
      const p_txn_at = new Date(trxAtInput).toISOString();

      const { error } = await supabase.rpc("perform_tenant_credit_topup", {
        p_amount: amount,
        p_txn_at,
        p_description: description || null,
      });

      if (error) {
        alert(error.message);
        return;
      }

      // refresh saldo tenant
      if (tenantId) {
        const { data: t } = await supabase
          .from("tenants")
          .select("credit_balance")
          .eq("id", tenantId)
          .single();
        if (typeof t?.credit_balance === "number") setCreditBalance(t.credit_balance);
      }

      // reload tabel ke halaman 1
      await load(1);
      setShowForm(false);
      router.refresh?.();
      alert("Credit Topup berhasil disimpan.");
    } finally {
      setSubmitting(false);
    }
  };

  /** ================= Render ================= */
  return (
    <div className="space-y-3">
      {/* Header: brand & saldo + tombol new */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Credit Topup — {bootLoading ? "…" : brand} &nbsp;|&nbsp; Credit Balance:&nbsp;
          <span className="font-semibold">
            {creditBalance != null ? formatID(creditBalance) : "—"}
          </span>
        </div>
        <button
          type="button"
          onClick={openNew}
          disabled={bootLoading || !(role === "admin" || role === "cs")}
          className="rounded bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
          title={
            bootLoading
              ? "Memuat…"
              : role === "admin" || role === "cs"
              ? "Buat Credit Topup"
              : "Hanya Admin & CS"
          }
        >
          New Credit Topup
        </button>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[900px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* -------- Row FILTERS (di atas header) -------- */}
            <tr className="filters">
              <th>
                <input
                  placeholder="ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <div className="flex gap-1">
                  <input
                    placeholder="min"
                    value={fMin}
                    onChange={(e) => setFMin(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                    className="w-full border rounded px-2 py-1"
                    inputMode="numeric"
                  />
                  <input
                    placeholder="max"
                    value={fMax}
                    onChange={(e) => setFMax(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                    className="w-full border rounded px-2 py-1"
                    inputMode="numeric"
                  />
                </div>
              </th>
              <th>
                <input
                  placeholder="note"
                  value={fNote}
                  onChange={(e) => setFNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
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
                  Submit
                </button>
              </th>
            </tr>

            {/* -------- Row HEADER -------- */}
            <tr>
              <th className="text-left">ID</th>
              <th className="text-left">Amount</th>
              <th className="text-left min-w-[240px]">Description</th>
              <th className="text-left">Transaction Date</th>
              <th className="text-left">Action</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5}>No data</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.id}</td>
                  <td>{formatID(r.delta_credit)}</td>
                  <td className="whitespace-normal break-words min-w-[240px]">
                    {r.note ?? "-"}
                  </td>
                  <td>
                    {new Date(r.created_at).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>
                  <td>—</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- Pagination ---------- */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button
            onClick={goFirst}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={goPrev}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>

          {getPageList().map((it, idx) =>
            it === "truncate" ? (
              <span
                key={`t-${idx}`}
                className="px-3 py-1 rounded border bg-white text-gray-500"
              >
                Truncate
              </span>
            ) : (
              <button
                key={it}
                onClick={() => load(it)}
                className={`px-3 py-1 rounded border ${
                  page === it ? "bg-blue-600 text-white" : "bg-white"
                }`}
              >
                {it}
              </button>
            )
          )}

          <button
            onClick={goNext}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={goLast}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>

      {/* ---------- Modal ---------- */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closeModal(); // klik overlay -> close
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitTopup();
            }}
            className="bg-white rounded border w-full max-w-xl mt-10"
          >
            <div className="p-4 border-b flex justify-between items-center">
              <div className="font-semibold">New Credit Topup — {brand}</div>
              <button
                type="button"
                onClick={closeModal}
                className="text-sm"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Amount</label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  placeholder="1.000.000"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  onBlur={(e) => {
                    const val = parseCurrency(e.target.value);
                    if (Number.isFinite(val) && val > 0) setAmountInput(formatID(val));
                  }}
                  inputMode="numeric"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input
                  type="datetime-local"
                  className="border rounded px-3 py-2"
                  value={trxAtInput}
                  onChange={(e) => setTrxAtInput(e.target.value)}
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
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded px-4 py-2 bg-blue-600 text-white disabled:opacity-50"
                title={role === "admin" || role === "cs" ? "" : "Hanya Admin & CS"}
              >
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
