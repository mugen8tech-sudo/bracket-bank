"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

type BMRow = {
  display_id: string;
  tenant_id: string;
  category: "Expense" | "Biaya Transaksi" | "Sesama CM" | "Depo" | "WD" | "Pending DP" | "Adjustment";
  bank_id: number;
  amount: number;              // sudah bertanda (+/-) = NET effect
  waktu_click: string;         // untuk sort & kolom "Waktu Click"
  final_1: string | null;      // untuk kolom "Waktu Dipilih" (baris atas)
  final_2: string | null;      // untuk TT (baris bawah)
  description: string | null;  // kolom Desc
  bank_note: string | null;    // subteks di bawah label Bank
  from_bank_id: number | null; // khusus TT
  to_bank_id: number | null;   // khusus TT
  created_by: string | null;
};

type BankLite = { id:number; bank_code:string; account_name:string; account_no:string };
type ProfileLite = { user_id: string; full_name: string | null };

const PAGE_SIZE = 100; // sesuai tabel besar lain

const startIsoJakarta = (d:string)=> new Date(`${d}T00:00:00+07:00`).toISOString();
const endIsoJakarta   = (d:string)=> new Date(`${d}T23:59:59.999+07:00`).toISOString();

const CAT_OPTIONS = ["ALL","Expense","Biaya Transaksi","Sesama CM","Depo","WD","Pending DP","Adjustment"] as const;
type CatOpt = typeof CAT_OPTIONS[number];

export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  // data & refs
  const [rows, setRows] = useState<BMRow[]>([]);
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [byMap, setByMap] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(true);

  // pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // filters
  const [fCat, setFCat] = useState<CatOpt>("ALL");
  const [fBankId, setFBankId] = useState<number | "ALL">("ALL");
  const [fStart, setFStart] = useState("");
  const [fFinish, setFFinish] = useState("");

  // label bank lengkap → [code] name - no
  const bankLabel = useMemo(() => {
    const map: Record<number,string> = {};
    for (const b of banks) map[b.id] = `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
    return (id:number)=> map[id] ?? `#${id}`;
  }, [banks]);

  // render “bank_note” khusus TT (ganti placeholder FROM/TO dengan label sebenarnya)
  const renderBankNote = (r: BMRow) => {
    if (r.category === "Sesama CM" || r.category === "Biaya Transaksi") {
      if (r.from_bank_id && r.to_bank_id) {
        return `Transfer dari ${bankLabel(r.from_bank_id)} ke ${bankLabel(r.to_bank_id)}`;
      }
    }
    return r.bank_note ?? "";
  };

  // load data
  const load = async (pageToLoad = page) => {
    setLoading(true);

    // bank list (untuk label)
    const { data: bankData, error: e1 } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no");
    if (e1) { setLoading(false); alert(e1.message); return; }

    // query view union
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    let q = supabase
      .from("bank_mutations_v")
      .select("*", { count: "exact" })
      .order("waktu_click", { ascending: false })
      .range(from, to);

    if (fCat !== "ALL") q = q.eq("category", fCat);
    if (fBankId !== "ALL") q = q.eq("bank_id", fBankId);
    if (fStart) q = q.gte("waktu_click", startIsoJakarta(fStart));
    if (fFinish) q = q.lte("waktu_click", endIsoJakarta(fFinish));

    const { data, error, count } = await q;
    if (error) { setLoading(false); alert(error.message); return; }

    const list = (data as BMRow[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    setPage(pageToLoad);
    setBanks((bankData as BankLite[]) ?? []);

    // map created_by → full_name (pola Expenses/Adjustments)
    const uids = Array.from(new Set(list.map(r=>r.created_by).filter(Boolean))) as string[];
    if (uids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", uids);
      const map: Record<string,string> = {};
      for (const p of (profs ?? []) as ProfileLite[]) {
        map[p.user_id] = p.full_name ?? p.user_id.slice(0,8);
      }
      setByMap(map);
    } else {
      setByMap({});
    }

    setLoading(false);
  };

  useEffect(()=>{ load(1); /* eslint-disable-next-line */ }, []);

  const apply = (e?:React.FormEvent)=>{ e?.preventDefault(); load(1); };

  // pagination helpers
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const goFirst = ()=> canPrev && load(1);
  const goPrev  = ()=> canPrev && load(page-1);
  const goNext  = ()=> canNext && load(page+1);
  const goLast  = ()=> canNext && load(totalPages);

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* === FILTER ROW (meniru interbank; tanggal 2 input untuk "mengunci" lebar Tgl) === */}
            <tr className="filters">
              <th className="w-28"></th> {/* ID */}
              <th className="min-w-[320px]">
                {/* Bank filter */}
                <div className="flex items-center gap-2">
                  <select
                    value={fBankId === "ALL" ? "ALL" : String(fBankId)}
                    onChange={(e)=> setFBankId(e.target.value==="ALL" ? "ALL" : Number(e.target.value))}
                    className="border rounded px-2 py-1 w-full"
                  >
                    <option value="ALL">ALL BANK</option>
                    {banks.map(b=>(
                      <option key={b.id} value={b.id}>
                        [{b.bank_code}] {b.account_name} - {b.account_no}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
              <th className="w-44">
                {/* Cat filter */}
                <select
                  value={fCat}
                  onChange={(e)=> setFCat(e.target.value as CatOpt)}
                  className="border rounded px-2 py-1 w-full"
                >
                  {CAT_OPTIONS.map(c=> <option key={c} value={c}>{c}</option>)}
                </select>
              </th>
              <th></th> {/* Desc (kosong, biar lebih lega) */}
              <th className="w-40"></th> {/* Amount */}
              <th className="w-52">
                {/* Date range berdasarkan Waktu Click */}
                <div className="flex flex-col gap-1">
                  <input type="date" value={fStart} onChange={(e)=>setFStart(e.target.value)} className="border rounded px-2 py-1" />
                  <input type="date" value={fFinish} onChange={(e)=>setFFinish(e.target.value)} className="border rounded px-2 py-1" />
                </div>
              </th>
              <th className="w-52"></th> {/* Waktu Dipilih */}
              <th className="w-40"></th> {/* Start */}
              <th className="w-40"></th> {/* Finish */}
              <th className="w-32">
                <button onClick={apply} className="rounded bg-blue-600 text-white px-3 py-1">Submit</button>
              </th>
            </tr>

            {/* === HEADER ROW === */}
            <tr>
              <th className="text-left w-28">ID</th>
              <th className="text-left">Bank</th>
              <th className="text-left w-44">Cat</th>
              <th className="text-left">Desc</th>
              <th className="text-left w-40">Amount</th>
              <th className="text-left w-52">Waktu Click</th>
              <th className="text-left w-52">Waktu Dipilih</th>
              <th className="text-left w-40">Start</th>
              <th className="text-left w-40">Finish</th>
              <th className="text-left w-32">Creator</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr><td colSpan={10}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10}>No data</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.display_id} className="hover:bg-gray-50">
                  {/* ID (sementara pakai prefiks jenis + id sumber agar unik & stabil) */}
                  <td className="whitespace-nowrap">{r.display_id}</td>

                  {/* Bank + garis + note unik */}
                  <td className="whitespace-normal break-words">
                    <div className="font-semibold">{bankLabel(r.bank_id)}</div>
                    <div className="border-t my-1" />
                    <div className="text-sm">{renderBankNote(r)}</div>
                  </td>

                  {/* Category */}
                  <td>{r.category}</td>

                  {/* Desc (Description asli) */}
                  <td><div className="whitespace-normal break-words">{r.description ?? ""}</div></td>

                  {/* Amount (sudah bertanda, format rata kiri meniru DP/WD) */}
                  <td className="text-left">{formatAmount(r.amount)}</td>

                  {/* Waktu Click */}
                  <td>
                    {new Date(r.waktu_click).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                  </td>

                  {/* Waktu Dipilih: 1 baris (umum) atau 2 baris (TT) */}
                  <td>
                    <div>
                      {r.final_1 ? new Date(r.final_1).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "-"}
                    </div>
                    {r.final_2 && (
                      <div>
                        {new Date(r.final_2).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                      </div>
                    )}
                  </td>

                  {/* Start/Finish — placeholder dulu, akan diisi saat ledger balance siap */}
                  <td>—</td>
                  <td>—</td>

                  {/* Creator */}
                  <td>{r.created_by ? (byMap[r.created_by] ?? r.created_by.slice(0,8)) : "-"}</td>
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
          <span className="px-3 py-1 rounded border bg-white">Page {page} / {totalPages}</span>
          <button onClick={goNext}  disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={goLast}  disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>
    </div>
  );
}
