"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type TT = {
  id: number;
  tenant_id: string;
  bank_from_id: number;
  bank_to_id: number;
  amount_gross: number;
  fee_amount: number;
  from_txn_at: string;
  to_txn_at: string;
  description: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null; // <-- computed column
};

type BankLite = {
  id: number;
  bank_code: string;
  account_name: string;
  account_no: string;
};

const PAGE_SIZE = 25;

export default function InterbankTransfersTable() {
  const supabase = supabaseBrowser();

  const [rows, setRows] = useState<TT[]>([]);
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [fStart, setFStart] = useState("");
  const [fFinish, setFFinish] = useState("");

  const startIsoJakarta = (d: string) =>
    new Date(`${d}T00:00:00+07:00`).toISOString();
  const endIsoJakarta = (d: string) =>
    new Date(`${d}T23:59:59.999+07:00`).toISOString();

  const bankLabel = useMemo(() => {
    const map: Record<number, string> = {};
    for (const b of banks) {
      map[b.id] = `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
    }
    return (id: number) => map[id] ?? `#${id}`;
  }, [banks]);

  const load = async (pageToLoad = page) => {
    setLoading(true);

    // bank list (label)
    const { data: bankData } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no");

    // interbank transfers
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("interbank_transfers")
      .select("*, created_by_name", { count: "exact" }) // <-- minta computed col
      .order("created_at", { ascending: false })
      .range(from, to);

    if (fStart) q = q.gte("created_at", startIsoJakarta(fStart));
    if (fFinish) q = q.lte("created_at", endIsoJakarta(fFinish));

    const { data, error, count } = await q;

    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }

    setRows((data as TT[]) ?? []);
    setTotal(count ?? 0);
    setPage(pageToLoad);
    setBanks((bankData as BankLite[]) ?? []);
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1);
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;
  const goFirst = () => canPrev && load(1);
  const goPrev = () => canPrev && load(page - 1);
  const goNext = () => canNext && load(page + 1);
  const goLast = () => canNext && load(totalPages);

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1000px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* FILTERS */}
            <tr className="filters">
              <th className="w-20"></th>                 {/* ID */}
              <th></th>                                   {/* Bank Asal */}
              <th></th>                                   {/* Bank Tujuan */}
              <th className="w-36"></th>                  {/* Amount */}
              <th className="w-52">                       {/* Tgl (atas-bawah) */}
                <div className="flex flex-col gap-1">
                  <input type="date" value={fStart} onChange={(e)=>setFStart(e.target.value)} className="border rounded px-2 py-1" />
                  <input type="date" value={fFinish} onChange={(e)=>setFFinish(e.target.value)} className="border rounded px-2 py-1" />
                </div>
              </th>
              <th className="w-28"></th>                  {/* By */}
              <th className="w-28">                       {/* Action */}
                <button onClick={apply} className="rounded bg-blue-600 text-white px-3 py-1">Submit</button>
              </th>
            </tr>

            {/* HEADER */}
            <tr>
              <th className="text-left w-20">ID</th>
              <th className="text-left min-w-[320px]">Bank Asal</th>
              <th className="text-left min-w-[320px]">Bank Tujuan</th>
              <th className="text-center w-36">Amount</th>
              <th className="text-center w-52">Tgl</th>
              <th className="text-center w-28">By</th>
              <th className="text-center w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7}>No data</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.id}</td>
                  <td className="whitespace-normal break-words">{bankLabel(r.bank_from_id)}</td>
                  <td className="whitespace-normal break-words">{bankLabel(r.bank_to_id)}</td>
                  <td className="text-center">{formatAmount(r.amount_gross)}</td>
                  <td className="text-center">
                    {new Date(r.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                  </td>
                  <td className="text-center">{r.created_by_name ?? r.created_by ?? "-"}</td>
                  <td className="text-center">
                    <a href={`/interbank-transfer/${r.id}`} className="rounded bg-gray-100 px-3 py-1 inline-block">Detail</a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button onClick={goFirst} disabled={!canPrev} className="px-3 py-1 rounded border bg-white disabled:opacity-50">First</button>
          <button onClick={goPrev}  disabled={!canPrev} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Previous</button>
          <span className="px-3 py-1 rounded border bg-white">Page {page} / {totalPages}</span>
          <button onClick={goNext}  disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={goLast}  disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>
    </div>
  );
}
