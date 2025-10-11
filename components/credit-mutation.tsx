"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/* ==== Role (konsisten Sidebar) ==== */
type Role = "admin" | "cs" | "viewer" | "other";
const normalizeRole = (r?: string | null): Role => {
  const v = (r || "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "cs" || v === "assops") return "cs";
  if (v === "viewer" || v === "agent") return "viewer";
  return "other";
};

/* ==== Helpers tanggal (filter di Waktu Click / submitted_at) ==== */
const toIsoStartJakarta = (d?: string) =>
  d ? new Date(`${d}T00:00:00+07:00`).toISOString() : null;
const toIsoEndJakarta = (d?: string) =>
  d ? new Date(`${d}T23:59:59.999+07:00`).toISOString() : null;

type Row = {
  id: number;                       // tenant_ledger.id (nomor urut mutasi)
  submitted_at: string;             // Waktu Click
  created_at: string;               // Waktu dipilih
  cat: string;                      // Depo/WD/PDP/Adjustment/Topup
  desc_text: string | null;         // Desc
  amount: number;                   // delta_credit
  start_balance: number;            // running balance (sebelum baris)
  finish_balance: number;           // running balance (sesudah baris)
  creator: string | null;           // profiles.full_name
  total_count: number;              // total hasil filter (untuk pagination)
};

const PAGE_SIZE = 25;

export default function CreditMutation() {
  const supabase = supabaseBrowser();

  // tenant + role + header balance
  const [brand, setBrand] = useState("TECH");
  const [role, setRole] = useState<Role>("other");
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // filters
  const [fStart, setFStart] = useState<string>("");
  const [fFinish, setFFinish] = useState<string>("");
  const [fCat, setFCat] = useState<"all"|"deposit"|"withdrawal"|"pdp_assign"|"credit_adjustment"|"credit_topup">("all");
  const [fDesc, setFDesc] = useState<string>("");
  const [fId, setFId] = useState<string>(""); // exact

  // data
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  // pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const pageOffset = useMemo(() => (page - 1) * PAGE_SIZE, [page]);

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

  // bootstrap tenant + role + credit
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

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
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshCredit = async () => {
    if (!tenantId) return;
    const { data: t } = await supabase
      .from("tenants")
      .select("credit_balance")
      .eq("id", tenantId)
      .single();
    if (typeof t?.credit_balance === "number") setCreditBalance(t.credit_balance);
  };

  const load = async (pageToLoad: number = page) => {
    if (!tenantId) return;
    setLoading(true);

    const { data, error } = await supabase.rpc("get_credit_mutations", {
      p_start: toIsoStartJakarta(fStart) as any,
      p_finish: toIsoEndJakarta(fFinish) as any,
      p_cat: fCat === "all" ? null : fCat,
      p_desc: fDesc || null,
      p_id: fId.trim() ? Number(fId.trim()) : null,
      p_offset: (pageToLoad - 1) * PAGE_SIZE,
      p_limit: PAGE_SIZE,
    });

    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }

    const list = (data as Row[]) ?? [];
    setRows(list);
    // total_count dikirim per-row → baca dari row pertama jika ada
    setTotal(list.length ? Number(list[0].total_count ?? 0) : 0);
    setPage(pageToLoad);
  };

  useEffect(() => {
    if (tenantId) load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const applyFilters: React.FormEventHandler = (e) => {
    e.preventDefault();
    load(1);
  };

  const canView = role === "admin" || role === "cs";

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="text-sm text-gray-600">
        Credit Mutations — {brand} &nbsp;|&nbsp; Balance sekarang:&nbsp;
        <b>{creditBalance != null ? formatAmount(creditBalance) : "—"}</b>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1200px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* Row FILTERS (di atas header) */}
            <tr className="filters">
              {/* ID */}
              <th>
                <input
                  placeholder="Cari ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </th>

              {/* Waktu Click (Start/Finish) */}
              <th>
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e) => setFStart(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Start"
                  />
                  <input
                    type="date"
                    value={fFinish}
                    onChange={(e) => setFFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Finish"
                  />
                </div>
              </th>

              {/* Waktu dipilih (no filter di kolom ini) */}
              <th />

              {/* Cat */}
              <th>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value as any)}
                >
                  <option value="all">All</option>
                  <option value="deposit">Depo</option>
                  <option value="withdrawal">WD</option>
                  <option value="pdp_assign">PDP</option>
                  <option value="credit_adjustment">Adjustment</option>
                  <option value="credit_topup">Topup</option>
                </select>
              </th>

              {/* Desc filter */}
              <th>
                <input
                  placeholder="Desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </th>

              {/* Amount / Start / Finish / Creator tak ada filter */}
              <th />
              <th />
              <th />
              <th className="whitespace-nowrap">
                <button onClick={applyFilters} className="rounded bg-blue-600 text-white px-3 py-1">
                  submit
                </button>
              </th>
            </tr>

            {/* Row HEADER */}
            <tr>
              <th className="text-left w-28">ID</th>
              <th className="text-left w-56">Waktu Click</th>
              <th className="text-left w-56">Waktu dipilih</th>
              <th className="text-left w-28">Cat</th>
              <th className="text-left min-w-[300px]">Desc</th>
              <th className="text-left w-44">Amount</th>
              <th className="text-left w-44">Start</th>
              <th className="text-left w-44">Finish</th>
              <th className="text-left w-48">Creator</th>
              <th className="text-left w-28">Action</th>
            </tr>
          </thead>

          <tbody>
            {!canView ? (
              <tr>
                <td colSpan={10}>Hanya Admin &amp; CS yang dapat melihat halaman ini.</td>
              </tr>
            ) : loading ? (
              <tr>
                <td colSpan={10}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10}>No data</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.id}</td>
                  <td>
                    {new Date(r.submitted_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                  </td>
                  <td>
                    {new Date(r.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                  </td>
                  <td>{r.cat}</td>
                  <td className="whitespace-normal break-words min-w-[300px]">
                    {r.desc_text ?? "-"}
                  </td>
                  <td>{formatAmount(r.amount)}</td>
                  <td>{formatAmount(r.start_balance)}</td>
                  <td>{formatAmount(r.finish_balance)}</td>
                  <td>{r.creator ?? "-"}</td>
                  <td>{/* (no action) */}</td>
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
    </div>
  );
}
