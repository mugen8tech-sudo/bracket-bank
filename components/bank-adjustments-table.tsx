"use client";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type BA = {
  id: number;
  tenant_id: string;
  bank_id: number;
  amount_delta: number; // signed
  txn_at_final: string;
  description: string | null;
  created_at: string;
  created_by: string | null;
};
type BankLite = { id:number; bank_code:string; account_name:string; account_no:string };
type ProfileLite = { user_id: string; full_name: string | null };

const PAGE_SIZE = 100;
const startIsoJakarta = (d:string)=> new Date(`${d}T00:00:00+07:00`).toISOString();
const endIsoJakarta   = (d:string)=> new Date(`${d}T23:59:59.999+07:00`).toISOString();

export default function BankAdjustmentsTable(){
  const supabase = supabaseBrowser();
  const [rows, setRows] = useState<BA[]>([]);
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [byMap, setByMap] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [fStart, setFStart] = useState("");
  const [fFinish, setFFinish] = useState("");

  const bankLabel = useMemo(()=>{
    const map: Record<number,string> = {};
    for (const b of banks) map[b.id] = b.account_name; // hanya NAME
    return (id:number)=> map[id] ?? `#${id}`;
  }, [banks]);

  const load = async (pageToLoad = page) => {
    setLoading(true);

    const { data: bankData } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no");

    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    let q = supabase
      .from("bank_adjustments")
      .select("*", { count: "exact" })
      .order("txn_at_final", { ascending: false })
      .range(from, to);

    if (fStart) q = q.gte("txn_at_final", startIsoJakarta(fStart));
    if (fFinish) q = q.lte("txn_at_final", endIsoJakarta(fFinish));

    const { data, error, count } = await q;
    setLoading(false);
    if (error) { alert(error.message); return; }

    // map created_by -> full_name (pola Deposits/Interbank)
    const uids = Array.from(new Set((data ?? []).map(r=>r.created_by).filter(Boolean) as string[]));
    let map: Record<string,string> = {};
    if (uids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", uids);
      for (const p of (profs ?? []) as ProfileLite[]) {
        map[p.user_id] = p.full_name ?? p.user_id?.slice(0,8) ?? "-";
      }
    }

    setRows((data as BA[]) ?? []);
    setTotal(count ?? 0);
    setPage(pageToLoad);
    setBanks((bankData as BankLite[]) ?? []);
    setByMap(map);
  };

  useEffect(()=>{ load(1); /* eslint-disable-next-line */ }, []);
  const apply = (e?:React.FormEvent)=>{ e?.preventDefault(); load(1); };

  const canPrev = page > 1, canNext = page < totalPages;
  const goFirst = ()=> canPrev && load(1);
  const goPrev  = ()=> canPrev && load(page - 1);
  const goNext  = ()=> canNext && load(page + 1);
  const goLast  = ()=> canNext && load(totalPages);

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1000px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* FILTER ROW: date-range ditempatkan di kolom Tgl */}
            <tr className="filters">
              <th className="w-24"></th>             {/* ID */}
              <th></th>                               {/* Bank */}
              <th className="w-32"></th>              {/* Amount */}
              <th></th>                               {/* Description */}
              <th className="w-[380px]">
                <div className="flex items-center gap-2">
                  <input type="date" value={fStart} onChange={(e)=>setFStart(e.target.value)} className="border rounded px-2 py-1" />
                  <input type="date" value={fFinish} onChange={(e)=>setFFinish(e.target.value)} className="border rounded px-2 py-1" />
                  <button onClick={apply} className="rounded bg-blue-600 text-white px-3 py-1">Submit</button>
                </div>
              </th>                                   {/* Tgl */}
              <th className="w-32"></th>              {/* By */}
              <th className="w-28"></th>              {/* Action */}
            </tr>

            {/* HEADER ROW */}
            <tr>
              <th className="text-left w-24">ID</th>          {/* + sedikit lebar */}
              <th className="text-left">Bank</th>             {/* sedikit lebih lebar dari sebelumnya (tanpa fixed width besar) */}
              <th className="text-left w-32">Amount</th>      {/* dipersempit */}
              <th className="text-left w-44">Description</th>      {/* diperlebar via konten & wrap */}
              <th className="text-left w-[380px]">Tgl</th>         {/* disempitkan */}
              <th className="text-left w-32">By</th>
              <th className="text-left w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7}>No data</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td>{r.id}</td>
                <td><div className="whitespace-normal break-words max-w-[220px]">{bankLabel(r.bank_id)}</div></td>
                <td>{formatAmount(r.amount_delta)}</td>
                <td><div className="whitespace-normal break-words max-w-[220px]">{r.description ?? ""}</div></td>
                <td>{new Date(r.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                <td>{r.created_by ? (byMap[r.created_by] ?? r.created_by.slice(0,8)) : "-"}</td>
                <td><a href={`/bank-adjustments/${r.id}`} className="rounded bg-gray-100 px-3 py-1 inline-block">Detail</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* pagination 100 */}
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
