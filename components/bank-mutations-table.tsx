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
            {/* ===== FILTERS ===== */}
            <tr className="filters">
              <th className="w-20"></th> {/* ID */}
              <th>
                {/* ALL BANK */}
                <select
                  value={fBankId === "ALL" ? "ALL" : String(fBankId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFBankId(v === "ALL" ? "ALL" : Number(v));
                  }}
                  className="border rounded px-2 py-1"
                >
                  <option value="ALL">ALL BANK</option>
                  {bankOptions.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      [{b.bank_code}] {b.account_name} - {b.account_no}
                    </option>
                  ))}
                </select>
              </th>
              <th className="w-28">
                {/* CAT */}
                <select value={fCat ?? ''} onChange={(e)=>setFCat(e.target.value)} className="border rounded px-2 py-1 w-full">
                  <option value="">ALL</option>
                  <option value="Expense">Expense</option>
                  <option value="Biaya Transfer">Biaya Transfer</option>
                  <option value="Sesama CM">Sesama CM</option>
                  <option value="Depo">Depo</option>
                  <option value="WD">WD</option>
                  <option value="Pending DP">Pending DP</option>
                  <option value="Adjustment">Adjustment</option>
                </select>
              </th>
              <th></th> {/* Desc */}
              <th className="w-40"></th> {/* Amount */}

              {/* Waktu Dipilih (range atas–bawah) */}
              <th className="w-40">
                <div className="flex flex-col gap-1">
                  <input type="date"  value={fStart}  onChange={(e)=>setFStart(e.target.value)}  className="border rounded px-2 py-1" />
                  <input type="date"  value={fFinish} onChange={(e)=>setFFinish(e.target.value)} className="border rounded px-2 py-1" />
                </div>
              </th>

              {/* Kolom yang tersisa untuk merapikan grid + tombol Submit di kanan */}
              <th className="w-40"></th> {/* Waktu Click (tidak difilter di grid) */}
              <th className="w-28"></th> {/* Start */}
              <th className="w-28"></th> {/* Finish */}
              <th className="w-28">
                <button onClick={apply} className="rounded bg-blue-600 text-white px-3 py-1 w-full">Submit</button>
              </th>
            </tr>

            {/* ===== HEADERS ===== */}
            <tr>
              <th className="text-left w-20">ID</th>
              <th className="text-left">Bank</th>
              <th className="text-left w-28">Cat</th>
              <th className="text-left">Desc</th>
              <th className="text-left w-40">Amount</th>
              <th className="text-left w-40">Waktu Click</th>
              <th className="text-left w-40">Waktu Dipilih</th>
              <th className="text-left w-28">Start</th>
              <th className="text-left w-28">Finish</th>
              <th className="text-left w-28">Creator</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.key /* pakai key unikmu */} className="hover:bg-gray-50">
                {/* ID nomor urut 1..n (kalau ada paging, pakai rumus total) */}
                <td>{typeof page === 'number' && typeof PAGE_SIZE === 'number'
                      ? (page - 1) * PAGE_SIZE + idx + 1
                      : idx + 1}</td>

                {/* Bank: label lengkap + keterangan sesuai Cat (sudah ada di implementasimu) */}
                <td className="whitespace-normal break-words">
                  {/* contoh struktur:
                     <div className="font-semibold">[{b.code}] {b.name} - {b.no}</div>
                     <div className="border-t my-1"></div>
                     <div>...keterangan unik (Transfer dari A ke B / Depo dari username / dsb.)</div>
                  */}
                  {renderBankCell(r)}
                </td>

                <td className="w-28">{r.category}</td>
                <td>{r.description ?? ""}</td>
                <td className="w-40">{formatAmount(r.amount_net ?? r.amount)}</td>

                {/* Waktu Click (lihat logika yang sudah kita set: TT=created_at; lainnya=txn_at_opened) */}
                <td className="w-40">
                  {new Date(r.click_time_iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                </td>

                {/* Waktu Dipilih: TT = 2 baris (from/to), lainnya = 1 baris (txn_at_final) */}
                <td className="w-40">
                  {r.kind === "TT" ? (
                    <>
                      <div>{new Date(r.from_txn_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</div>
                      <div>{new Date(r.to_txn_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</div>
                    </>
                  ) : (
                    new Date(r.txn_at_final).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
                  )}
                </td>

                <td className="w-28">{formatAmount(r.open_balance)}</td>
                <td className="w-28">{formatAmount(r.close_balance)}</td>
                <td className="w-28">{r.created_by_name ?? r.created_by?.slice(0,8) ?? "-"}</td>
              </tr>
            ))}
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
