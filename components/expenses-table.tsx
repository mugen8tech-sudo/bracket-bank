"use client";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

const EXPENSE_CATEGORY_CODES = [
  "AIR", "BELI REKENING", "BONUS CRM", "BONUS CS", "BONUS MEMBER",
  "BONUS PLAYER", "BONUS SPV", "BONUS TELE", "DATABASE", "DOMAIN & HOSTING",
  "ENTERTAINMENT", "GAJI CS", "GAJI CS WA BLAST", "GAJI DESIGN", "GAJI FINANCE",
  "GAJI HEAD CS", "GAJI HEAD WA BLAST", "GAJI OB", "GAJI PAID ADS", "GAJI SEO",
  "GAJI SPV", "GAJI SPV CRM", "GAJI TELE", "IKLAN", "INTERNET", "INTERNET SEHAT (NAWALA)",
  "IP FEE", "KEAMANAN", "KEBERSIHAN", "KESEHATAN", "KOORDINASI", "LAIN-LAIN", "LAUNDRY",
  "LISTRIK", "LIVECHAT", "MAINTENANCE", "MAKAN", "PANTRY", "PAYPAL", "PERALATAN", "PERLENGKAPAN",
  "PULSA", "RENOVASI FURNITURE & ELECTRONIC", "RENOVASI SIPIL", "SEO", "SETUP FEE (APK)",
  "SEWA", "SKYPE", "SMS BLAST", "THR", "TICKET & TRANSPORTASI", "MAINTENANCE FEE", "OTHER EXPENSE", "MISTAKE CS"
];

type EXP = {
  id: number;
  tenant_id: string;
  bank_id: number;
  amount: number; // negatif
  category_code: string | null;
  txn_at_final: string;
  description: string | null;
  created_at: string;
  created_by: string | null;
};

type BankLite = { id:number; bank_code:string; account_name:string; account_no:string };
type ProfileLite = { user_id:string; full_name:string|null };

const PAGE_SIZE = 100;

export default function ExpensesTable(){
  const supabase = supabaseBrowser();
  const [rows, setRows] = useState<EXP[]>([]);
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [byMap, setByMap] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [fStart, setFStart] = useState("");
  const [fFinish, setFFinish] = useState("");

  const startIsoJak = (d:string)=> new Date(`${d}T00:00:00+07:00`).toISOString();
  const endIsoJak   = (d:string)=> new Date(`${d}T23:59:59.999+07:00`).toISOString();

  const bankLabel = useMemo(()=>{
    const map: Record<number,string> = {};
    for (const b of banks) {
      map[b.id] = `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
    }
    return (id:number)=> map[id] ?? `#${id}`;
  }, [banks]);

  const load = async (pageToLoad=page) => {
    setLoading(true);

    const { data: bankData } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no");

    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    let q = supabase
      .from("bank_expenses")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    const [fCat, setFCat] = useState<string>("ALL");
    if (fCat && fCat !== "ALL") q = q.eq("category_code", fCat);

    // filter tanggal berdasar created_at (submit time)
    if (fStart) q = q.gte("created_at", startIsoJak(fStart));
    if (fFinish) q = q.lte("created_at", endIsoJak(fFinish));

    const { data, error, count } = await q;
    if (error) { setLoading(false); alert(error.message); return; }

    // who map
    const ids = Array.from(new Set(((data ?? []) as EXP[]).map(r=>r.created_by).filter(Boolean) as string[]));
    let map: Record<string,string> = {};
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles").select("user_id, full_name").in("user_id", ids);
      for (const p of (profs ?? []) as ProfileLite[]) {
        map[p.user_id] = p.full_name ?? p.user_id.slice(0,8);
      }
    }

    setRows((data as EXP[]) ?? []);
    setTotal(count ?? 0);
    setPage(pageToLoad);
    setBanks((bankData as BankLite[]) ?? []);
    setByMap(map);
    setLoading(false);
  };

  useEffect(()=>{ load(1); /* eslint-disable-next-line */ }, []);
  const apply = (e?:React.FormEvent)=>{ e?.preventDefault(); load(1); };

  const canPrev = page > 1, canNext = page < totalPages;
  const goFirst=()=> canPrev && load(1);
  const goPrev =()=> canPrev && load(page-1);
  const goNext =()=> canNext && load(page+1);
  const goLast =()=> canNext && load(totalPages);

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1000px]" style={{borderCollapse:"collapse"}}>
          <thead>
            {/* FILTER ROW — Category + date-range */}
            <tr className="filters">
              <th colSpan={3}></th> {/* ID + Bank + Amount */}
              <th>
                <select
                  value={fCat}
                  onChange={(e)=>{ setFCat(e.target.value); apply(); }}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="ALL">ALL</option>
                  {EXPENSE_CATEGORY_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </th>
              <th colSpan={2}>
                <div className="flex items-center gap-2">
                  <input type="date" value={fStart} onChange={(e)=>setFStart(e.target.value)} className="border rounded px-2 py-1" />
                  <input type="date" value={fFinish} onChange={(e)=>setFFinish(e.target.value)} className="border rounded px-2 py-1" />
                  <button onClick={apply} className="rounded bg-blue-600 text-white px-3 py-1">Submit</button>
                </div>
              </th>
              <th colSpan={2}></th> {/* By + Action */}
            </tr>

            {/* HEADER ROW */}
            <tr>
              <th className="text-left w-20">ID</th>
              <th className="text-left">Bank</th>
              <th className="text-left">Amount</th>
              <th className="text-left w-40">Category</th>
              <th className="text-left">Description</th>
              <th className="text-left">Tgl</th>
              <th className="text-left">By</th>
              <th className="text-left w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7}>No data</td></tr>
            ) : rows.map(r=>(
              <tr key={r.id} className="hover:bg-gray-50">
                <td>{r.id}</td>
                <td className="whitespace-normal break-words">{bankLabel(r.bank_id)}</td>
                <td>{formatAmount(r.amount)}</td>
                <td>{r.category_code ?? "-"}</td>
                <td><div className="whitespace-normal break-words">{r.description ?? ""}</div></td>
                <td>{new Date(r.created_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td>
                <td>{r.created_by ? (byMap[r.created_by] ?? r.created_by.slice(0,8)) : "-"}</td>
                <td><a href={`/expenses/${r.id}`} className="rounded bg-gray-100 px-3 py-1 inline-block">Detail</a></td>
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
