"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";
import Link from "next/link";

type WithdrawalRow = {
  id: number;
  tenant_id: string;
  bank_id: number;
  lead_id: number | null;
  username_snapshot: string;
  lead_name_snapshot: string | null;
  amount_gross: number;
  transfer_fee_amount: number;
  amount_net: number;
  txn_at_final: string;
  created_by: string | null;
  is_deleted: boolean;
};

type ProfileLite = { user_id: string; full_name: string | null };

const PAGE_SIZE = 100;

function startOfDayJakartaISO(d: string) {
  return new Date(`${d}T00:00:00+07:00`).toISOString();
}
function endOfDayJakartaISO(d: string) {
  return new Date(`${d}T23:59:59.999+07:00`).toISOString();
}

export default function WithdrawalsTable() {
  const supabase = supabaseBrowser();

  // summary hari ini
  const [sumToday, setSumToday] = useState(0);
  const [countToday, setCountToday] = useState(0);
  const [playersToday, setPlayersToday] = useState(0);

  // list & pagination
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [loading, setLoading] = useState(true);

  // filters
  const [fLead, setFLead] = useState("");
  const [fUser, setFUser] = useState("");
  const [fStart, setFStart] = useState("");
  const [fFinish, setFFinish] = useState("");
  const [fDeleted, setFDeleted] = useState<"ALL"|"YES"|"NO">("ALL");

  // who created mapping
  const [whoMap, setWhoMap] = useState<Record<string, string>>({});

  const loadToday = async () => {
    const now = new Date();
    const y = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const s = startOfDayJakartaISO(y);
    const e = endOfDayJakartaISO(y);
    const { data, error } = await supabase
      .from("withdrawals")
      .select("amount_gross, username_snapshot")
      .gte("txn_at_final", s)
      .lte("txn_at_final", e)
      .eq("is_deleted", false);
    if (error) { console.error(error); return; }
    const list = (data ?? []) as {amount_gross:number; username_snapshot:string}[];
    setSumToday(list.reduce((a,b)=>a+Number(b.amount_gross||0),0));
    setCountToday(list.length);
    setPlayersToday(new Set(list.map(x=>x.username_snapshot)).size);
  };

  const buildQuery = () => {
    let q = supabase.from("withdrawals").select("*",{count:"exact"}).order("txn_at_final",{ascending:false});
    if (fLead.trim()) q = q.ilike("lead_name_snapshot", `%${fLead.trim()}%`);
    if (fUser.trim()) q = q.ilike("username_snapshot", `%${fUser.trim()}%`);
    if (fStart) q = q.gte("txn_at_final", startOfDayJakartaISO(fStart));
    if (fFinish) q = q.lte("txn_at_final", endOfDayJakartaISO(fFinish));
    if (fDeleted === "YES") q = q.eq("is_deleted", true);
    if (fDeleted === "NO")  q = q.eq("is_deleted", false);
    return q;
  };

  const load = async (pageToLoad = page) => {
    setLoading(true);
    const from = (pageToLoad-1) * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    const { data, error, count } = await buildQuery().range(from, to);
    setLoading(false);
    if (error) { alert(error.message); return; }

    const list = (data as WithdrawalRow[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);

    const uids = Array.from(new Set(list.map(x=>x.created_by).filter(Boolean))) as string[];
    if (uids.length) {
      const { data: pf } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", uids);
      const map: Record<string,string> = {};
      (pf as ProfileLite[] | null)?.forEach(p => { map[p.user_id] = p.full_name ?? p.user_id; });
      setWhoMap(map);
    } else setWhoMap({});
  };

  useEffect(()=>{ loadToday(); }, []);
  useEffect(()=>{ load(1); }, []);

  const applyFilters = (e?: React.FormEvent) => { e?.preventDefault(); load(1); };

  // delete modal
  const [delOpen, setDelOpen] = useState(false);
  const [delNote, setDelNote] = useState("");
  const [delRow, setDelRow] = useState<WithdrawalRow | null>(null);
  const [delBank, setDelBank] = useState<{bank_code:string; account_name:string; account_no:string} | null>(null);

  const openDelete = async (r: WithdrawalRow) => {
    setDelRow(r); setDelNote(""); setDelOpen(true); setDelBank(null);
    const { data: b } = await supabase
      .from("banks")
      .select("bank_code, account_name, account_no")
      .eq("id", r.bank_id)
      .single();
    if (b) setDelBank(b as any);
  };
  const closeDelete = () => { setDelOpen(false); setDelBank(null); };

  const submitDelete = async () => {
    if (!delRow) return;
    if (!delNote.trim()) { alert("Keterangan Penghapusan wajib diisi"); return; }
    const { error } = await supabase.rpc("delete_withdrawal", {
      p_withdrawal_id: delRow.id,
      p_delete_note: delNote.trim()
    });
    if (error) { alert(error.message); return; }
    setDelOpen(false);
    await load(page);
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="space-y-3">
      <div className="rounded border bg-white p-3 text-sm">
        <b>Withdrawals</b> | {formatAmount(sumToday)} | {countToday} transaction | {playersToday} player
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="filters">
              <th className="w-24"></th>
              <th>
                <input placeholder="Lead name" value={fLead} onChange={(e)=>setFLead(e.target.value)} onKeyDown={(e)=>e.key==='Enter' && applyFilters()} className="w-full border rounded px-2 py-1" />
              </th>
              <th>
                <input placeholder="Username" value={fUser} onChange={(e)=>setFUser(e.target.value)} onKeyDown={(e)=>e.key==='Enter' && applyFilters()} className="w-full border rounded px-2 py-1" />
              </th>
              <th></th>
              <th>
                <div className="flex flex-col gap-1">
                  <input type="date" value={fStart} onChange={(e)=>setFStart(e.target.value)} className="border rounded px-2 py-1" />
                  <input type="date" value={fFinish} onChange={(e)=>setFFinish(e.target.value)} className="border rounded px-2 py-1" />
                </div>
              </th>
              <th></th>
              <th>
                <select value={fDeleted} onChange={(e)=>setFDeleted(e.target.value as any)} className="border rounded px-2 py-1">
                  <option value="ALL">ALL</option>
                  <option value="YES">YES</option>
                  <option value="NO">NO</option>
                </select>
              </th>
              <th className="whitespace-nowrap">
                <button onClick={applyFilters} className="rounded bg-blue-600 text-white px-3 py-1">Submit</button>
              </th>
            </tr>
            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left min-w-[220px]">Lead</th>
              <th className="text-left min-w-[180px]">Player</th>
              <th className="text-left w-32">Amount</th>
              <th className="text-left w-52">Tgl</th>
              <th className="text-left w-32">By</th>
              <th className="text-left w-24">Deleted?</th>
              <th className="text-left w-40">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8}>No data</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td className="whitespace-normal break-words">{r.lead_name_snapshot ?? "-"}</td>
                  <td>{r.username_snapshot}</td>
                  <td className="text-left">{formatAmount(r.amount_gross)}</td>
                  <td>{new Date(r.txn_at_final).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td>
                  <td>{r.created_by ? (whoMap[r.created_by] ?? r.created_by) : "-"}</td>
                  <td>{r.is_deleted ? "YES" : "NO"}</td>
                  <td className="space-x-2">
                    <Link href={`/withdrawals/${r.id}`} className="rounded bg-gray-100 px-3 py-1">Detail</Link>
                    {!r.is_deleted && (
                      <button onClick={()=>openDelete(r)} className="rounded bg-red-600 text-white px-3 py-1">Delete</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button onClick={()=>{ if(page<=1) return; setPage(1); load(1); }} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">First</button>
          <button onClick={()=>{ if(page<=1) return; load(page-1); }} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Previous</button>
          <span className="px-3 py-1 rounded border bg-white">Page {page} / {totalPages}</span>
          <button onClick={()=>{ if(page>=totalPages) return; load(page+1); }} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={()=>{ if(page>=totalPages) return; load(totalPages); }} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>

      {/* Delete modal */}
      {delOpen && delRow && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center p-4" onMouseDown={(e)=>{ if (e.currentTarget === e.target) closeDelete(); }}>
          <form onSubmit={(e)=>{ e.preventDefault(); submitDelete(); }} className="bg-white rounded border w-full max-w-2xl mt-10">
            <div className="p-4 border-b font-semibold">Konfirmasi delete withdrawal?</div>
            <div className="p-4">
              <table className="table-grid w-full">
                <tbody>
                  <tr><td className="w-48">Bank</td><td>{delBank ? `[${delBank.bank_code}] ${delBank.account_name} - ${delBank.account_no}` : "Loading..."}</td></tr>
                  <tr><td>Player</td><td>{delRow.username_snapshot}</td></tr>
                  <tr><td>Jumlah</td><td>{formatAmount(delRow.amount_gross)}</td></tr>
                  <tr><td>Biaya Transaksi</td><td>{formatAmount(delRow.transfer_fee_amount)}</td></tr>
                  <tr><td>Tgl Transaksi</td><td>{new Date(delRow.txn_at_final).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td></tr>
                </tbody>
              </table>
              <div className="mt-3">
                <label className="block text-xs mb-1">Keterangan Penghapusan</label>
                <input className="border rounded px-3 py-2 w-full" value={delNote} onChange={(e)=>setDelNote(e.target.value)} />
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={closeDelete} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button type="submit" className="rounded px-4 py-2 bg-red-600 text-white">Submit</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
