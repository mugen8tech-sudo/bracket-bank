"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ===== Helpers (Asia/Jakarta) ===== */
const startIsoJakarta = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toISOString();
const endIsoJakarta = (d: string) =>
  new Date(`${d}T23:59:59.999+07:00`).toISOString();

/** ====== Master types (subset kolom yang kita pakai) ====== */
type BankLite = { id: number; bank_code: string; account_name: string; account_no: string };
type ProfileLite = { user_id: string; full_name: string | null };

/** ====== Sumber data ====== */
type Deposit = {
  id: number; bank_id: number; amount_net: number;
  txn_at_opened: string | null; txn_at_final: string;
  username_snapshot: string | null; lead_name_snapshot: string | null;
  description: string | null; created_by: string | null;
};
type Withdrawal = {
  id: number; bank_id: number; amount_gross: number; transfer_fee_amount: number;
  txn_at_opened: string | null; txn_at_final: string;
  username_snapshot: string | null; description: string | null; created_by: string | null;
};
type PendingDeposit = {
  id: number; bank_id: number; amount_net: number;
  txn_at_opened: string | null; txn_at_final: string;
  description: string | null; created_by: string | null;
};
type Adjustment = {
  id: number; bank_id: number; amount_delta: number;
  txn_at_final: string; description: string | null; created_at: string; created_by: string | null;
};
type Expense = {
  id: number; bank_id: number; amount: number;
  category_code: string | null; description: string | null;
  txn_at_final: string; created_at: string; created_by: string | null;
};
type TT = {
  id: number; bank_from_id: number; bank_to_id: number;
  amount_gross: number; fee_amount: number;
  from_txn_at: string; to_txn_at: string;
  created_at: string; created_by: string | null; description: string | null;
};

/** ====== Item gabungan (yang ditampilkan) ====== */
type MutItem = {
  key: string;               // kunci unik React, contoh: "DP-15", "TT-8-FROM"
  sourceRef: string;         // referensi untuk filter ID (mis. "DP-15", "TT-8")
  bank_id: number;
  bank_label: string;
  cat: "Expense" | "Biaya Transaksi" | "Sesama CM" | "Depo" | "WD" | "Pending DP" | "Adjustment";
  desc: string;
  amount: number;            // signed (+/-)
  clickTime: string;         // untuk kolom Waktu Click
  finalTimes: string[];      // untuk kolom Waktu Dipilih (TT: 2 baris; lainnya: 1 baris)
  creator: string | null;    // user_id (nanti di-map ke full_name)
};

/** ====== Kategori dropdown ====== */
const CAT_OPTIONS = [
  "ALL",
  "Expense",
  "Biaya Transaksi",
  "Sesama CM",
  "Depo",
  "WD",
  "Pending DP",
  "Adjustment",
] as const;
type CatFilter = (typeof CAT_OPTIONS)[number];

/** ====== Komponen ====== */
export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  // banks & map label
  const [banks, setBanks] = useState<BankLite[]>([]);
  const bankLabel = useMemo(() => {
    const map: Record<number, string> = {};
    for (const b of banks) map[b.id] = `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
    return (id: number) => map[id] ?? `#${id}`;
  }, [banks]);

  // who created map
  const [byMap, setByMap] = useState<Record<string, string>>({});

  // filter states
  const [fBankId, setFBankId] = useState<string>(""); // "" = ALL BANK
  const [fCat, setFCat] = useState<CatFilter>("ALL");
  const [fId, setFId] = useState<string>("");         // search ID (sourceRef)
  const [fDesc, setFDesc] = useState<string>("");     // search Desc
  const [fStart, setFStart] = useState<string>("");
  const [fFinish, setFFinish] = useState<string>("");

  // data gabungan + paging
  const [items, setItems] = useState<MutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  /** ====== Load banks (untuk label) ====== */
  const loadBanks = async () => {
    const { data } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no");
    setBanks((data as BankLite[]) ?? []);
  };

  /** ====== Load data per tabel (menggunakan filter tanggal) ====== */
  const loadAll = async () => {
    setLoading(true);

    // siapkan rentang waktu (dipakai di kolom Waktu Dipilih)
    const hasRange = !!(fStart || fFinish);
    const s = fStart ? startIsoJakarta(fStart) : undefined;
    const e = fFinish ? endIsoJakarta(fFinish)   : undefined;

    // helper untuk apply gte/lte
    const rangeFinal = <T,>(
      q: any,
      col: string
    ): Promise<{ data: T[] | null; error: any }> => {
      if (s) q = q.gte(col, s);
      if (e) q = q.lte(col, e);
      return q;
    };

    // --- query paralel (pakai kolom "final" masing-masing) ---
    const [
      depRes,
      wdRes,
      pdpRes,
      adjRes,
      expRes,
      ttRes,
    ] = await Promise.all([
      rangeFinal<Deposit>(
        supabase.from("deposits").select(
          "id, bank_id, amount_net, txn_at_opened, txn_at_final, username_snapshot, lead_name_snapshot, description, created_by"
        ).order("txn_at_final", { ascending: false }),
        "txn_at_final"
      ),
      rangeFinal<Withdrawal>(
        supabase.from("withdrawals").select(
          "id, bank_id, amount_gross, transfer_fee_amount, txn_at_opened, txn_at_final, username_snapshot, description, created_by"
        ).order("txn_at_final", { ascending: false }),
        "txn_at_final"
      ),
      rangeFinal<PendingDeposit>(
        supabase.from("pending_deposits").select(
          "id, bank_id, amount_net, txn_at_opened, txn_at_final, description, created_by"
        ).order("txn_at_final", { ascending: false }),
        "txn_at_final"
      ),
      rangeFinal<Adjustment>(
        supabase.from("bank_adjustments").select(
          "id, bank_id, amount_delta, txn_at_final, description, created_at, created_by"
        ).order("txn_at_final", { ascending: false }),
        "txn_at_final"
      ),
      rangeFinal<Expense>(
        supabase.from("bank_expenses").select(
          "id, bank_id, amount, category_code, description, txn_at_final, created_at, created_by"
        ).order("txn_at_final", { ascending: false }),
        "txn_at_final"
      ),
      // TT: filter pada salah satu waktu final (from/to), plus created_at untuk click
      (async () => {
        let q = supabase
          .from("interbank_transfers")
          .select(
            "id, bank_from_id, bank_to_id, amount_gross, fee_amount, from_txn_at, to_txn_at, created_at, created_by, description"
          )
          .order("created_at", { ascending: false });
        if (hasRange) {
          // masukkan jika salah satu waktu final berada pada rentang
          if (s) {
            q = q.or(`from_txn_at.gte.${s},to_txn_at.gte.${s}`);
          }
          if (e) {
            q = q.or(`from_txn_at.lte.${e},to_txn_at.lte.${e}`);
          }
        }
        const { data, error } = await q;
        return { data: (data as TT[]) ?? null, error };
      })(),
    ]);

    // kumpulkan semua user_id untuk map → full_name
    const userIds = new Set<string>();
    [
      depRes.data ?? [],
      wdRes.data ?? [],
      pdpRes.data ?? [],
      adjRes.data ?? [],
      expRes.data ?? [],
      ttRes.data ?? [],
    ].forEach((rows: any[]) =>
      rows.forEach((r) => r.created_by && userIds.add(r.created_by))
    );

    // ambil profile
    let who: Record<string, string> = {};
    if (userIds.size) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", Array.from(userIds));
      for (const p of (profs ?? []) as ProfileLite[]) {
        who[p.user_id] = p.full_name ?? p.user_id.slice(0, 8);
      }
    }
    setByMap(who);

    // map → MutItem[]
    const list: MutItem[] = [];

    // DP
    for (const r of (depRes.data ?? [])) {
      const whoName = r.username_snapshot || r.lead_name_snapshot || "-";
      list.push({
        key: `DP-${r.id}`,
        sourceRef: `DP-${r.id}`,
        bank_id: r.bank_id,
        bank_label: bankLabel(r.bank_id),
        cat: "Depo",
        desc: `Depo dari ${whoName}`,
        amount: Number(r.amount_net || 0), // plus
        clickTime: r.txn_at_opened ?? r.txn_at_final,
        finalTimes: [r.txn_at_final],
        creator: r.created_by,
      });
    }

    // WD (gross + fee jadi 2 baris)
    for (const r of (wdRes.data ?? [])) {
      const whoName = r.username_snapshot || "-";
      // WD (gross)
      list.push({
        key: `WD-${r.id}`,
        sourceRef: `WD-${r.id}`,
        bank_id: r.bank_id,
        bank_label: bankLabel(r.bank_id),
        cat: "WD",
        desc: `WD dari ${whoName}`,
        amount: -Number(r.amount_gross || 0), // minus gross
        clickTime: r.txn_at_opened ?? r.txn_at_final,
        finalTimes: [r.txn_at_final],
        creator: r.created_by,
      });
      // Biaya Transaksi (fee)
      const fee = Number(r.transfer_fee_amount || 0);
      if (fee > 0) {
        list.push({
          key: `WD-FEE-${r.id}`,
          sourceRef: `WD-${r.id}`,
          bank_id: r.bank_id,
          bank_label: bankLabel(r.bank_id),
          cat: "Biaya Transaksi",
          desc: `Biaya transfer WD #${r.id}`,
          amount: -fee,
          clickTime: r.txn_at_opened ?? r.txn_at_final,
          finalTimes: [r.txn_at_final],
          creator: r.created_by,
        });
      }
    }

    // PDP
    for (const r of (pdpRes.data ?? [])) {
      list.push({
        key: `PDP-${r.id}`,
        sourceRef: `PDP-${r.id}`,
        bank_id: r.bank_id,
        bank_label: bankLabel(r.bank_id),
        cat: "Pending DP",
        desc: "Pending Deposit",
        amount: Number(r.amount_net || 0), // plus
        clickTime: r.txn_at_opened ?? r.txn_at_final,
        finalTimes: [r.txn_at_final],
        creator: r.created_by,
      });
    }

    // Adjustment
    for (const r of (adjRes.data ?? [])) {
      list.push({
        key: `ADJ-${r.id}`,
        sourceRef: `ADJ-${r.id}`,
        bank_id: r.bank_id,
        bank_label: bankLabel(r.bank_id),
        cat: "Adjustment",
        desc: r.description ?? "",
        amount: Number(r.amount_delta || 0), // signed
        clickTime: r.created_at,             // klik = created
        finalTimes: [r.txn_at_final],
        creator: r.created_by,
      });
    }

    // Expense
    for (const r of (expRes.data ?? [])) {
      list.push({
        key: `EXP-${r.id}`,
        sourceRef: `EXP-${r.id}`,
        bank_id: r.bank_id,
        bank_label: bankLabel(r.bank_id),
        cat: "Expense",
        desc: r.description ?? "",
        amount: -Math.abs(Number(r.amount || 0)), // keluar (minus)
        clickTime: r.created_at,                   // klik = created
        finalTimes: [r.txn_at_final],
        creator: r.created_by,
      });
    }

    // TT → FROM & TO (net = gross, fee baris terpisah pada FROM)
    for (const r of (ttRes.data ?? [])) {
      // FROM
      list.push({
        key: `TT-${r.id}-FROM`,
        sourceRef: `TT-${r.id}`,
        bank_id: r.bank_from_id,
        bank_label: bankLabel(r.bank_from_id),
        cat: "Sesama CM",
        desc: `Transfer dari ${bankLabel(r.bank_from_id)} ke ${bankLabel(r.bank_to_id)}`,
        amount: -Number(r.amount_gross || 0), // keluar (gross)
        clickTime: r.created_at,
        finalTimes: [r.from_txn_at, r.to_txn_at], // dua baris
        creator: r.created_by,
      });
      // TO
      list.push({
        key: `TT-${r.id}-TO`,
        sourceRef: `TT-${r.id}`,
        bank_id: r.bank_to_id,
        bank_label: bankLabel(r.bank_to_id),
        cat: "Sesama CM",
        desc: `Transfer dari ${bankLabel(r.bank_from_id)} ke ${bankLabel(r.bank_to_id)}`,
        amount: Number(r.amount_gross || 0), // masuk (gross)
        clickTime: r.created_at,
        finalTimes: [r.from_txn_at, r.to_txn_at], // dua baris
        creator: r.created_by,
      });
      // Biaya transfer pada FROM
      const fee = Number(r.fee_amount || 0);
      if (fee > 0) {
        list.push({
          key: `TT-${r.id}-FEE-FROM`,
          sourceRef: `TT-${r.id}`,
          bank_id: r.bank_from_id,
          bank_label: bankLabel(r.bank_from_id),
          cat: "Biaya Transaksi",
          desc: `Biaya transfer TT #${r.id}`,
          amount: -fee,
          clickTime: r.created_at,
          finalTimes: [r.from_txn_at],
          creator: r.created_by,
        });
      }
    }

    // filter client-side: bank/cat/desc/id + range (kalau user isi range, sudah difilter query; tetap cek tambahan untuk TT/OR)
    let all = list;

    // Bank
    if (fBankId) {
      const idNum = Number(fBankId);
      all = all.filter((x) => x.bank_id === idNum);
    }

    // Category
    if (fCat !== "ALL") {
      all = all.filter((x) => x.cat === fCat);
    }

    // ID (sourceRef)
    if (fId.trim()) {
      const q = fId.trim().toLowerCase();
      all = all.filter((x) => x.sourceRef.toLowerCase().includes(q));
    }

    // Desc
    if (fDesc.trim()) {
      const q = fDesc.trim().toLowerCase();
      all = all.filter((x) => x.desc.toLowerCase().includes(q));
    }

    // Range akhir (tambahan safeguard untuk TT yang kita pakai OR from/to)
    if (hasRange) {
      const S = s!, E = e!;
      const inRange = (iso: string) => (!S || iso >= S) && (!E || iso <= E);
      all = all.filter((x) => x.finalTimes.some(inRange));
    }

    // sorting: terbaru berdasarkan Waktu Click (desc)
    all.sort((a, b) => (a.clickTime < b.clickTime ? 1 : -1));

    setItems(all);
    setLoading(false);
  };

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    setPage(1);
    loadAll();
  };

  useEffect(() => {
    // muat awal
    (async () => {
      await loadBanks();
      await loadAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pagination slice
  const pageItems = useMemo(() => {
    const from = (page - 1) * PAGE_SIZE;
    return items.slice(from, from + PAGE_SIZE);
  }, [items, page]);

  // daftar bank utk dropdown
  const bankOptions = useMemo(() => banks.map(b => ({
    id: String(b.id),
    label: `[${b.bank_code}] ${b.account_name} - ${b.account_no}`,
  })), [banks]);

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1200px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* ==== FILTER BARIS ATAS ==== */}
            <tr className="filters">
              {/* ID filter */}
              <th className="w-20">
                <input
                  placeholder="Cari ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>

              {/* Bank dropdown */}
              <th>
                <select
                  value={fBankId}
                  onChange={(e) => setFBankId(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="">ALL BANK</option>
                  {bankOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </th>

              {/* Cat dropdown */}
              <th className="w-40">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value as CatFilter)}
                  className="border rounded px-2 py-1 w-full"
                >
                  {CAT_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </th>

              {/* Desc search */}
              <th>
                <input
                  placeholder="Search description"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>

              {/* Amount: kosong (grid penyeimbang) */}
              <th></th>

              {/* Waktu Click: kosong */}
              <th></th>

              {/* Waktu Dipilih: range + Submit */}
              <th>
                <div className="flex items-center gap-2">
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
                  <button onClick={apply} className="rounded bg-blue-600 text-white px-3 py-1">
                    Submit
                  </button>
                </div>
              </th>

              {/* Start / Finish / Creator : kosong */}
              <th></th>
              <th></th>
              <th></th>
            </tr>

            {/* ==== HEADER ROW (match screenshot) ==== */}
            <tr>
              <th className="text-left w-20">ID</th>
              <th className="text-left">Bank</th>
              <th className="text-left w-40">Cat</th>
              <th className="text-left">Desc</th>
              <th className="text-left w-40">Amount</th>
              <th className="text-left w-52">Waktu Click</th>
              <th className="text-left w-52">Waktu Dipilih</th>
              <th className="text-left w-28">Start</th>
              <th className="text-left w-28">Finish</th>
              <th className="text-left w-36">Creator</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr><td colSpan={10}>Loading…</td></tr>
            ) : pageItems.length === 0 ? (
              <tr><td colSpan={10}>No data</td></tr>
            ) : (
              pageItems.map((r, idx) => {
                const rowNo = (page - 1) * PAGE_SIZE + idx + 1; // 1..N (bukan DP/TT…)
                return (
                  <tr key={r.key} className="hover:bg-gray-50">
                    <td>{rowNo}</td>
                    <td className="whitespace-normal break-words">
                      {/* Format kolom Bank + pembeda sesuai cat */}
                      <div className="font-medium">{r.bank_label}</div>
                      <div className="border-t my-1"></div>
                      <div className="text-sm">{r.desc}</div>
                    </td>
                    <td>{r.cat}</td>
                    <td><div className="whitespace-normal break-words">{r.desc}</div></td>
                    <td>{formatAmount(r.amount)}</td>
                    <td>{new Date(r.clickTime).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                    <td>
                      {/* satu/dwi-baris */}
                      {r.finalTimes.map((t, i) => (
                        <div key={i}>
                          {new Date(t).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                        </div>
                      ))}
                    </td>
                    {/* Start/Finish: belum dihitung ledger → placeholder “—” agar kolom terkunci rapih */}
                    <td>—</td>
                    <td>—</td>
                    <td>{r.creator ? (byMap[r.creator] ?? r.creator.slice(0, 8)) : "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ==== Pagination (100/halaman) ==== */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button onClick={() => canPrev && setPage(1)}        disabled={!canPrev} className="px-3 py-1 rounded border bg-white disabled:opacity-50">First</button>
          <button onClick={() => canPrev && setPage(page - 1)} disabled={!canPrev} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Previous</button>
          <span className="px-3 py-1 rounded border bg-white">Page {page} / {totalPages}</span>
          <button onClick={() => canNext && setPage(page + 1)} disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Next</button>
          <button onClick={() => canNext && setPage(totalPages)} disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">Last</button>
        </nav>
      </div>
    </div>
  );
}
