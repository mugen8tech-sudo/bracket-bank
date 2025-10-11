"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";
import Link from "next/link";

type DepositRow = {
  id: number;
  tenant_id: string;
  bank_id: number;
  lead_id: number | null;
  username_snapshot: string;
  lead_name_snapshot: string | null;
  amount_gross: number;
  fee_direct_amount: number;
  amount_net: number;
  txn_at_final: string;
  created_by: string | null;
  created_by_name: string | null; // <-- computed column dari DB
  is_deleted: boolean;
};

const PAGE_SIZE = 50;

function startOfDayJakartaISO(d: string) {
  return new Date(`${d}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(d: string) {
  return new Date(`${d}T23:59:59.999+07:00`).toISOString();
}

export default function DepositsTable() {
  const supabase = supabaseBrowser();

  // header summary (hari ini)
  const [sumToday, setSumToday] = useState<number>(0);
  const [countToday, setCountToday] = useState<number>(0);
  const [playersToday, setPlayersToday] = useState<number>(0);

  // list & pagination
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [loading, setLoading] = useState(true);

  // filters
  const [fLead, setFLead] = useState("");
  const [fUser, setFUser] = useState("");
  const [fStart, setFStart] = useState("");
  const [fFinish, setFFinish] = useState("");
  const [fDeleted, setFDeleted] = useState<"ALL" | "YES" | "NO">("ALL");

  // today summary
  const loadToday = async () => {
    const now = new Date();
    const y = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); // yyyy-mm-dd
    const s = startOfDayJakartaISO(y);
    const e = endOfDayJakartaISO(y);

    const { data, error } = await supabase
      .from("deposits")
      .select("amount_net, username_snapshot")
      .gte("txn_at_final", s)
      .lte("txn_at_final", e)
      .eq("is_deleted", false);

    if (error) {
      console.error(error);
      return;
    }
    const list =
      ((data ?? []) as { amount_net: number; username_snapshot: string }[]) ||
      [];
    setSumToday(list.reduce((a, b) => a + Number(b.amount_net || 0), 0));
    setCountToday(list.length);
    setPlayersToday(new Set(list.map((x) => x.username_snapshot)).size);
  };

  const buildQuery = () => {
    let q = supabase
      .from("deposits")
      // minta computed column 'created_by_name'
      .select("*, created_by_name", { count: "exact" })
      .order("txn_at_final", { ascending: false });

    if (fLead.trim()) q = q.ilike("lead_name_snapshot", `%${fLead.trim()}%`);
    if (fUser.trim()) q = q.ilike("username_snapshot", `%${fUser.trim()}%`);
    if (fStart) q = q.gte("txn_at_final", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("txn_at_final", endOfDayJakartaISO(fFinish));
    if (fDeleted === "YES") q = q.eq("is_deleted", true);
    if (fDeleted === "NO") q = q.eq("is_deleted", false);

    return q;
  };

  const load = async (pageToLoad = page) => {
    setLoading(true);
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await buildQuery().range(from, to);
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }

    const list = (data as DepositRow[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);
  };

  useEffect(() => {
    loadToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1);
  };

  // ===== Delete modal =====
  const [delOpen, setDelOpen] = useState(false);
  const [delNote, setDelNote] = useState("");
  const [delRow, setDelRow] = useState<DepositRow | null>(null);
  const [delBank, setDelBank] = useState<{
    bank_code: string;
    account_name: string;
    account_no: string;
  } | null>(null);

  const openDelete = async (r: DepositRow) => {
    setDelRow(r);
    setDelNote("");
    setDelOpen(true);
    setDelBank(null);
    const { data: b } = await supabase
      .from("banks")
      .select("bank_code, account_name, account_no")
      .eq("id", r.bank_id)
      .single();
    if (b) setDelBank(b as any);
  };

  const closeDelete = useCallback(() => setDelOpen(false), []);

  // NEW: ESC untuk menutup modal Delete (klik overlay tetap seperti semula)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && delOpen) {
        e.preventDefault();
        closeDelete();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [delOpen, closeDelete]);

  const submitDelete = async () => {
    if (!delRow) return;
    if (!delNote.trim()) {
      alert("Keterangan Penghapusan wajib diisi");
      return;
    }
    const { error } = await supabase.rpc("delete_deposit", {
      p_deposit_id: delRow.id,
      p_delete_note: delNote.trim(),
    });
    if (error) {
      alert(error.message);
      return;
    }
    setDelOpen(false);
    await load(page);
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="space-y-3">
      {/* Header summary hari ini */}
      <div className="rounded border bg-white p-3 text-sm">
        <b>Deposits</b> | {formatAmount(sumToday)} | {countToday} transaction |{" "}
        {playersToday} player
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table
          className="table-grid min-w-[1100px]"
          style={{ borderCollapse: "collapse" }}
        >
          <thead>
            {/* Row filters */}
            <tr className="filters">
              <th className="w-24"></th>
              <th>
                <input
                  placeholder="Lead name"
                  value={fLead}
                  onChange={(e) => setFLead(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th>
                <input
                  placeholder="Username"
                  value={fUser}
                  onChange={(e) => setFUser(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              <th></th>
              <th>
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fStart}
                    onChange={(e) => setFStart(e.target.value)}
                    className="border rounded px-2 py-1"
                  />
                  <input
                    type="date"
                    value={fFinish}
                    onChange={(e) => setFFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                  />
                </div>
              </th>
              <th></th>
              <th>
                <select
                  value={fDeleted}
                  onChange={(e) => setFDeleted(e.target.value as any)}
                  className="border rounded px-2 py-1"
                >
                  <option value="ALL">ALL</option>
                  <option value="YES">YES</option>
                  <option value="NO">NO</option>
                </select>
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

            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left min-w-[220px]">Lead</th>
              <th className="text-left min-w-[180px]">Player</th>
              {/* Amount rata kiri */}
              <th className="text-left w-32">Amount</th>
              <th className="text-left w-52">Tgl</th>
              <th className="text-left w-32">By</th>
              <th className="text-left w-24">Deleted?</th>
              <th className="text-left w-40">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8}>No data</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td className="whitespace-normal break-words">
                    {r.lead_name_snapshot ?? "-"}
                  </td>
                  <td>{r.username_snapshot}</td>
                  {/* Amount rata kiri */}
                  <td className="text-left">{formatAmount(r.amount_net)}</td>
                  <td>
                    {new Date(r.txn_at_final).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>
                  <td>{r.created_by_name ?? r.created_by ?? "-"}</td>
                  <td>{r.is_deleted ? "YES" : "NO"}</td>
                  <td className="space-x-2">
                    <Link
                      href={`/deposits/${r.id}`}
                      className="rounded bg-gray-100 px-3 py-1"
                    >
                      Detail
                    </Link>
                    {!r.is_deleted && (
                      <button
                        onClick={() => openDelete(r)}
                        className="rounded bg-red-600 text-white px-3 py-1"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* pagination 100/halaman */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button
            onClick={() => {
              if (page <= 1) return;
              setPage(1);
              load(1);
            }}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => {
              if (page <= 1) return;
              load(page - 1);
            }}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => {
              if (page >= totalPages) return;
              load(page + 1);
            }}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => {
              if (page >= totalPages) return;
              load(totalPages);
            }}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>

      {/* Delete modal */}
      {delOpen && delRow && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center p-4"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) closeDelete();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitDelete();
            }}
            className="bg-white rounded border w-full max-w-2xl mt-10"
          >
            <div className="p-4 border-b font-semibold">
              Konfirmasi delete deposit?
            </div>
            <div className="p-4">
              <table className="table-grid w-full">
                <tbody>
                  <tr>
                    <td className="w-40">Bank Penerima</td>
                    <td>
                      {delBank
                        ? `[${delBank.bank_code}] ${delBank.account_name} - ${delBank.account_no}`
                        : "Loading..."}
                    </td>
                  </tr>
                  <tr>
                    <td>Player</td>
                    <td>{delRow.username_snapshot}</td>
                  </tr>
                  <tr>
                    <td>Jumlah</td>
                    <td>{formatAmount(delRow.amount_net)}</td>
                  </tr>
                  <tr>
                    <td>Direct Fee</td>
                    <td>{formatAmount(delRow.fee_direct_amount)}</td>
                  </tr>
                  <tr>
                    <td>Tgl Transaksi</td>
                    <td>
                      {new Date(delRow.txn_at_final).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3">
                <label className="block text-xs mb-1">
                  Keterangan Penghapusan
                </label>
                <input
                  className="border rounded px-3 py-2 w-full"
                  value={delNote}
                  onChange={(e) => setDelNote(e.target.value)}
                />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDelete}
                className="rounded px-4 py-2 bg-gray-100"
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded px-4 py-2 bg-red-600 text-white"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
