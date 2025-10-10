"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import { formatAmount } from "@/lib/format";

/* ================= Roles (konsisten dgn Sidebar) ================= */
type AppRole = "admin" | "cs" | "viewer" | "other";
const normalizeRole = (r?: string | null): AppRole => {
  const v = (r || "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "cs" || v === "assops") return "cs";
  if (v === "viewer" || v === "agent") return "viewer";
  return "other";
};

/* ================= Amount helpers (adopsi Banks) ================= */
// live grouping: "1234.5" -> "1,234.5" (maks 2 desimal), caret tetap nyaman
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
function toNumber(input: string) {
  let c = (input || "0").replace(/,/g, "");
  if (c.endsWith(".")) c = c.slice(0, -1);
  const n = Number(c);
  return isNaN(n) ? 0 : n;
}

/* ================= Date helpers ================= */
const toInputLocal = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/* ================= Types ================= */
type TopupRow = {
  id: number;
  tenant_id: string;
  delta_credit: number;
  note: string | null;
  created_at: string;     // timestamptz
  created_by: string | null;
};

const PAGE_SIZE = 25;

export default function CreditTopup() {
  const supabase = supabaseBrowser();
  const router = useRouter();

  // ===== tenant & role =====
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [brand, setBrand] = useState("TECH");
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [role, setRole] = useState<AppRole>("other");
  const [booting, setBooting] = useState(true);

  // ===== data =====
  const [rows, setRows] = useState<TopupRow[]>([]);
  const [nameBy, setNameBy] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // ===== pagination =====
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
    if (totalPages <= 10) {
      for (let i = 1; i <= totalPages; i++) list.push(i);
      return list;
    }
    if (page <= 6) return [1, 2, 3, 4, 5, 6, "truncate", totalPages];
    if (page >= totalPages - 5) {
      list.push(1, "truncate");
      for (let i = totalPages - 5; i <= totalPages; i++) list.push(i);
      return list;
    }
    return [1, "truncate", page - 1, page, page + 1, "truncate", totalPages];
  };

  // ===== modal =====
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [amountStr, setAmountStr] = useState("0.00");
  const [trxAt, setTrxAt] = useState(toInputLocal(new Date()));
  const [description, setDescription] = useState("");
  const amountRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = useMemo(
    () => (role === "admin" || role === "cs") && !submitting,
    [role, submitting]
  );

  /* ================= Bootstrap ================= */
  useEffect(() => {
    (async () => {
      setBooting(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setBooting(false);
        return;
      }

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
          .select("slug, name, credit_balance")
          .eq("id", prof.tenant_id)
          .single();

        setBrand(tenant?.slug || tenant?.name || "—");
        setCreditBalance(
          typeof tenant?.credit_balance === "number" ? tenant!.credit_balance : null
        );
      }
      setBooting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ================= Loader ================= */
  const load = async (pageToLoad = page) => {
    if (!tenantId) return;
    setLoading(true);

    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    // Ambil topup ledger untuk tenant ini
    const { data, error, count } = await supabase
      .from("tenant_ledger")
      .select("id, tenant_id, delta_credit, note, created_at, created_by", {
        count: "exact",
      })
      .eq("tenant_id", tenantId)
      .eq("ref_type", "credit_topup")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      setLoading(false);
      alert(error.message);
      return;
    }

    const list = (data as TopupRow[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);

    // Ambil nama pembuat (By) sekali jalan
    const ids = Array.from(
      new Set(list.map((r) => r.created_by).filter(Boolean)) as string[]
    );
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => (map[p.user_id] = p.full_name || p.user_id));
      setNameBy(map);
    } else {
      setNameBy({});
    }

    setLoading(false);
  };

  // load saat tenantId siap
  useEffect(() => {
    if (tenantId) load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  /* ================= Modal handlers ================= */
  const openNew = () => {
    if (role !== "admin" && role !== "cs") {
      alert("Hanya Admin & CS yang bisa melakukan Credit Topup.");
      return;
    }
    setAmountStr("0.00");
    setTrxAt(toInputLocal(new Date()));
    setDescription("");
    setShowForm(true);
    setTimeout(() => amountRef.current?.select(), 0);
  };

  const closeModal = useCallback(() => setShowForm(false), []);

  // ESC untuk close
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeModal();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm, closeModal]);

  /* ================= Submit ================= */
  const submitTopup = async () => {
    if (role !== "admin" && role !== "cs") {
      alert("Hanya Admin & CS yang bisa melakukan Credit Topup.");
      return;
    }
    const amt = toNumber(amountStr);
    if (!(amt > 0)) {
      alert("Amount harus lebih dari 0.");
      amountRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("perform_tenant_credit_topup", {
        p_amount: amt,
        p_txn_at: new Date(trxAt).toISOString(),
        p_description: description || null,
      });
      if (error) {
        alert(error.message);
        return;
      }

      // Refresh saldo & tabel
      if (tenantId) {
        const { data: t } = await supabase
          .from("tenants")
          .select("credit_balance")
          .eq("id", tenantId)
          .single();
        if (typeof t?.credit_balance === "number")
          setCreditBalance(t.credit_balance);
      }
      await load(1);

      setShowForm(false);
      router.refresh?.();
      alert("Credit Topup berhasil disimpan.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ================= UI ================= */
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Credit Topup — {booting ? "…" : brand} &nbsp;|&nbsp; Credit Balance:&nbsp;
          <span className="font-semibold">
            {creditBalance != null ? formatAmount(creditBalance) : "—"}
          </span>
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
            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left w-48">Amount</th>
              <th className="text-left min-w-[320px]">Description</th>
              <th className="text-left w-60">Tgl</th>
              <th className="text-left w-60">By</th>
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
                  <td>{formatAmount(r.delta_credit)}</td>
                  <td className="whitespace-normal break-words min-w-[320px]">
                    {r.note ?? "-"}
                  </td>
                  <td>
                    {new Date(r.created_at).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>
                  <td>{r.created_by ? nameBy[r.created_by] ?? r.created_by : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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

      {/* Modal */}
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
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold">New Credit Topup — {brand}</div>
              <button type="button" onClick={closeModal} className="text-sm" aria-label="Close">
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs mb-1">Amount</label>
                <input
                  ref={amountRef}
                  className="border rounded px-3 py-2 w-full"
                  value={amountStr}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const f = formatWithGroupingLive(e.target.value);
                    setAmountStr(f);
                    setTimeout(() => {
                      const el = amountRef.current;
                      if (el) {
                        const L = el.value.length;
                        el.setSelectionRange(L, L);
                      }
                    }, 0);
                  }}
                  onBlur={() => {
                    const n = toNumber(amountStr);
                    setAmountStr(
                      new Intl.NumberFormat("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(n)
                    );
                  }}
                  inputMode="numeric"
                  placeholder="1,000,000.00"
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
            </div>

            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
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
