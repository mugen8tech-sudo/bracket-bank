"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type PendingRow = {
  id: number;
  tenant_id: string;
  bank_id: number;
  amount_gross: number;
  fee_direct_amount: number;
  amount_net: number;
  description: string | null;
  txn_at_final: string;
  is_assigned: boolean;
  assigned_username_snapshot: string | null;
  is_deleted: boolean;
  created_by: string | null;
};

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string };
type LeadLite = { id: number; username: string | null; name: string | null; bank: string | null; bank_name: string | null; bank_no: string | null };

const PAGE_SIZE = 25;

function startDayJakISO(d: string) { return new Date(`${d}T00:00:00+07:00`).toISOString(); }
function endDayJakISO(d: string)   { return new Date(`${d}T23:59:59.999+07:00`).toISOString(); }
function nowLocalDatetimeValue() {
  const d = new Date(); const pad=(n:number)=>`${n}`.padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* live thousand separators */
function fmtLive(raw: string) {
  let c = raw.replace(/,/g,"").replace(/[^\d.]/g,"");
  const i = c.indexOf("."); if (i !== -1) c = c.slice(0,i+1) + c.slice(i+1).replace(/\./g,"");
  let [int="0", frac] = c.split("."); int = int.replace(/^0+(?=\d)/,""); if(int==="") int="0";
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g,",");
  if (frac !== undefined) return frac.length===0 ? g+"." : g+"."+frac.slice(0,2);
  return g;
}
function toNum(s:string){ let c=s.replace(/,/g,""); if(c.endsWith(".")) c=c.slice(0,-1); const n=Number(c); return isNaN(n)?0:n;}

export default function PendingDepositsTable() {
  const supabase = supabaseBrowser();

  const [rows, setRows] = useState<PendingRow[]>([]);
  const [banks, setBanks] = useState<Record<number, BankLite>>({});
  const [loading, setLoading] = useState(true);
  const [countNotAssigned, setCountNotAssigned] = useState(0);

  // filter
  const [fStart, setFStart] = useState("");
  const [fFinish, setFFinish] = useState("");
  const [fStatus, setFStatus] = useState<"ALL"|"ASSIGNED"|"NOT_ASSIGNED">("ALL");

  // paging
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // assign modal
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRow, setAssignRow] = useState<PendingRow | null>(null);
  const [assignTxn, setAssignTxn] = useState(nowLocalDatetimeValue());
  const [leadQuery, setLeadQuery] = useState("");
  const [leadOptions, setLeadOptions] = useState<LeadLite[]>([]);
  const [leadIndex, setLeadIndex] = useState(0);
  const [leadPick, setLeadPick] = useState<LeadLite | null>(null);
  const playerRef = useRef<HTMLInputElement | null>(null);

  // delete modal
  const [delOpen, setDelOpen] = useState(false);
  const [delRow, setDelRow] = useState<PendingRow | null>(null);
  const [delBank, setDelBank] = useState<BankLite | null>(null);
  const [delNote, setDelNote] = useState("");

  useEffect(()=> {
    const onKey=(e:KeyboardEvent)=>{ if(e.key==="Escape"){ if(assignOpen) setAssignOpen(false); if(delOpen) setDelOpen(false);} };
    document.addEventListener("keydown", onKey);
    return ()=>document.removeEventListener("keydown", onKey);
  },[assignOpen, delOpen]);

  const load = async (pageToLoad = page) => {
    setLoading(true);

    // query utama
    let q = supabase.from("pending_deposits").select("*",{count:"exact"}).order("txn_at_final",{ascending:false});

    if (fStart) q = q.gte("txn_at_final", startDayJakISO(fStart));
    if (fFinish) q = q.lte("txn_at_final", endDayJakISO(fFinish));
    if (fStatus === "ASSIGNED") q = q.eq("is_assigned", true);
    if (fStatus === "NOT_ASSIGNED") q = q.eq("is_assigned", false);

    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    const { data, error, count } = await q.range(from, to);
    if (error) { setLoading(false); alert(error.message); return; }

    const list = (data as PendingRow[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);

    // map bank info
    const ids = Array.from(new Set(list.map(x=>x.bank_id)));
    if (ids.length) {
      const { data: bs } = await supabase.from("banks").select("id, bank_code, account_name, account_no").in("id", ids);
      const map: Record<number,BankLite> = {};
      (bs as BankLite[] | null)?.forEach(b => map[b.id]=b);
      setBanks(map);
    } else { setBanks({}); }

    // hitung not assigned pada rentang filter (termasuk yg deleted)
    let q2 = supabase.from("pending_deposits").select("id", { count:"exact", head:true });
    if (fStart) q2 = q2.gte("txn_at_final", startDayJakISO(fStart));
    if (fFinish) q2 = q2.lte("txn_at_final", endDayJakISO(fFinish));
    q2 = q2.eq("is_assigned", false);
    const { count: cNot } = await q2;
    setCountNotAssigned(cNot ?? 0);

    setLoading(false);
  };

  useEffect(()=>{ load(1); /* eslint-disable-next-line */ }, []);
  const apply = (e?:React.FormEvent)=>{ e?.preventDefault(); load(1); };

  // cari player (assign)
  useEffect(()=> {
    let active = true;
    (async ()=>{
      if(!assignOpen) return;
      const q = leadQuery.trim();
      if (!q) { setLeadOptions([]); return; }
      const { data, error } = await supabase
        .from("leads")
        .select("id, username, name, bank, bank_name, bank_no")
        .ilike("username", q)
        .limit(10);
      if(!active) return;
      if(error){ console.error(error); return; }
      setLeadOptions((data as LeadLite[]) ?? []);
      setLeadIndex(0);
    })();
    return ()=>{ active=false; };
  }, [leadQuery, assignOpen, supabase]);

  const openAssign = (r: PendingRow) => {
    setAssignRow(r); setAssignOpen(true); setAssignTxn(nowLocalDatetimeValue());
    setLeadQuery(""); setLeadOptions([]); setLeadPick(null); setLeadIndex(0);
  };
  const closeAssign = () => setAssignOpen(false);

  const submitAssign = async () => {
    if(!assignRow) return;
    if(!leadPick || !leadPick.username){ alert("Pilih Player dulu"); playerRef.current?.focus(); return; }
    const { error } = await supabase.rpc("assign_pending_deposit", {
      p_pending_id: assignRow.id,
      p_lead_id: leadPick.id,
      p_username: leadPick.username,
      p_txn_at_final: new Date(assignTxn).toISOString()
    });
    if(error){ alert(error.message); return; }
    setAssignOpen(false);
    await load(page);
  };

  const openDelete = async (r: PendingRow) => {
    setDelRow(r); setDelNote(""); setDelOpen(true); setDelBank(null);
    const { data: b } = await supabase.from("banks").select("id, bank_code, account_name, account_no").eq("id", r.bank_id).single();
    if (b) setDelBank(b as any);
  };
  const closeDelete = ()=> setDelOpen(false);
  const submitDelete = async ()=> {
    if (!delRow) return;
    if (!delNote.trim()) { alert("Keterangan Penghapusan wajib diisi"); return; }
    const { error } = await supabase.rpc("delete_pending_deposit", {
      p_pending_id: delRow.id,
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
        <b>Pending Deposits</b> | ({countNotAssigned}) not assigned
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1000px]" style={{borderCollapse:"collapse"}}>
          <thead>
            <tr className="filters">
              <th className="w-24"></th>
              <th></th>
              <th></th>
              <th>
                <div className="flex flex-col gap-1">
                  <input type="date" value={fStart} onChange={(e)=>setFStart(e.target.value)} className="border rounded px-2 py-1"/>
                  <input type="date" value={fFinish} onChange={(e)=>setFFinish(e.target.value)} className="border rounded px-2 py-1"/>
                </div>
              </th>
              <th>
                <select value={fStatus} onChange={(e)=>setFStatus(e.target.value as any)} className="border rounded px-2 py-1">
                  <option value="ALL">ALL</option>
                  <option value="ASSIGNED">ASSIGNED</option>
                  <option value="NOT_ASSIGNED">NOT ASSIGNED</option>
                </select>
              </th>
              <th className="whitespace-nowrap">
                <button onClick={apply} className="rounded bg-blue-600 text-white px-3 py-1">Submit</button>
              </th>
            </tr>
            <tr>
              <th className="text-left w-24">ID</th>
              <th className="text-left min-w-[320px]">Bank / Description</th>
              <th className="text-left w-40">Amount</th>
              <th className="text-left w-52">Tgl</th>
              <th className="text-left w-56">Status</th>
              <th className="text-left w-56">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6}>No data</td></tr>
            ) : rows.map(r => {
              const b = banks[r.bank_id];
              return (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td className="whitespace-normal break-words">
                    <div className="font-semibold">[{b?.bank_code}] {b?.account_name}</div>
                    <div className="text-xs text-gray-700">{b?.account_no}</div>
                    {/* garis tipis pemisah */}
                    <div className="border-t my-1"></div>
                    <div className="">{r.description ?? ""}</div>
                  </td>
                  <td className="text-left">{formatAmount(r.amount_net)}</td>
                  <td>{new Date(r.txn_at_final).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td>
                  <td>
                    {r.is_assigned
                      ? <>• Player: {r.assigned_username_snapshot}</>
                      : <>PENDING ASSIGNMENT</>
                    }
                  </td>
                  <td className="space-x-2">
                    {r.is_assigned ? (
                      <span>Sudah di assign</span>
                    ) : r.is_deleted ? (
                      <span>Sudah di delete</span>
                    ) : (
                      <>
                        <button onClick={()=>openAssign(r)} className="rounded bg-blue-600 text-white px-3 py-1">Assign</button>
                        <button onClick={()=>openDelete(r)} className="rounded bg-red-600 text-white px-3 py-1">Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* pagination 25 */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button onClick={()=>{ if(page<=1) return; setPage(1); load(1); }} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">First</button>
          <button onClick={()=>{ if(page<=1) return; load(page-1); }} disabled={page<=1} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Previous</button>
          <span className="px-3 py-1 rounded border bg-white">Page {page} / {totalPages}</span>
          <button onClick={()=>{ if(page>=totalPages) return; load(page+1); }} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={()=>{ if(page>=totalPages) return; load(totalPages); }} disabled={page>=totalPages} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>

      {/* Assign modal */}
      {assignOpen && assignRow && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center p-4" onMouseDown={(e)=>{ if(e.currentTarget===e.target) closeAssign(); }}>
          <form onSubmit={(e)=>{ e.preventDefault(); submitAssign(); }} className="bg-white rounded border w-full max-w-2xl mt-10">
            <div className="p-4 border-b font-semibold">
              Deposit to [{banks[assignRow.bank_id]?.bank_code}] {banks[assignRow.bank_id]?.account_name} - {banks[assignRow.bank_id]?.account_no}
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><div className="text-gray-500">Amount</div><div className="font-medium">{formatAmount(assignRow.amount_net)}</div></div>
                <div><div className="text-gray-500">Tgl Transaksi</div><div className="font-medium">{new Date(assignRow.txn_at_final).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</div></div>
              </div>
              <div>
                <label className="block text-xs mb-1">Transaction Date</label>
                <input type="datetime-local" className="border rounded px-3 py-2 w-full" value={assignTxn} onChange={(e)=>setAssignTxn(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs mb-1">Player</label>
                <div className="relative">
                  <input ref={playerRef} className="border rounded px-3 py-2 w-full"
                         placeholder="search"
                         value={leadPick ? (leadPick.username ?? "") : leadQuery}
                         onChange={(e)=>{ setLeadPick(null); setLeadQuery(e.target.value); }}
                         onKeyDown={(e)=>{
                           if(!leadPick && leadOptions.length>0){
                             if(e.key==="ArrowDown"){ e.preventDefault(); setLeadIndex(i=>Math.min(i+1, leadOptions.length-1)); return; }
                             if(e.key==="ArrowUp"){ e.preventDefault(); setLeadIndex(i=>Math.max(i-1,0)); return; }
                             if(e.key==="Enter"){ e.preventDefault(); const pick=leadOptions[Math.max(0,leadIndex)]; if(pick){ setLeadPick(pick); setLeadOptions([]);} return; }
                           }
                         }}/>
                  {!leadPick && leadOptions.length>0 && (
                    <div className="absolute z-10 mt-1 max-h-56 overflow-auto w-full border bg-white rounded shadow">
                      {leadOptions.map((opt,idx)=>(
                        <div key={opt.id}
                             onClick={()=>{ setLeadPick(opt); setLeadOptions([]); }}
                             className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-100 ${idx===leadIndex?"bg-blue-50":""}`}>
                          {opt.username} ({opt.bank ?? opt.bank_name} | {opt.name} | {opt.bank_no})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t p-4 flex justify-end gap-2">
              <button type="button" onClick={closeAssign} className="rounded px-4 py-2 bg-gray-100">Close</button>
              <button type="submit" className="rounded px-4 py-2 bg-blue-600 text-white">Submit</button>
            </div>
          </form>
        </div>
      )}

      {/* Delete modal */}
      {delOpen && delRow && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center p-4" onMouseDown={(e)=>{ if(e.currentTarget===e.target) closeDelete(); }}>
          <form onSubmit={(e)=>{ e.preventDefault(); submitDelete(); }} className="bg-white rounded border w-full max-w-2xl mt-10">
            <div className="p-4 border-b font-semibold">Konfirmasi delete deposit?</div>
            <div className="p-4">
              <table className="table-grid w-full">
                <tbody>
                  <tr><td className="w-48">Bank Penerima</td><td>[{delBank?.bank_code}] {delBank?.account_name} - {delBank?.account_no}</td></tr>
                  <tr><td>Jumlah</td><td>{formatAmount(delRow.amount_gross)}</td></tr>
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
