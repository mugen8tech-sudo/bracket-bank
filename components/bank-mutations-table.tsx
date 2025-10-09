"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/**
 * Catatan sumber kolom:
 * - deposits/withdrawals/pending_deposits umumnya punya txn_at_opened & txn_at_final (Waktu Click / Waktu Dipilih)
 * - bank_expenses/bank_adjustments: fallback Waktu Click = created_at bila tidak ada opened
 * - interbank_transfers: Waktu Click = created_at; Waktu Dipilih = 2 baris (from_txn_at, to_txn_at)
 *
 * Tabel referensi gaya & kolom:
 * - InterbankTransfersTable (layout filter & kolom), ExpensesTable, BankAdjustmentsTable. 
 */

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string };
type ProfileLite = { user_id: string; full_name: string | null };

/* ===== raw rows dari berbagai tabel ===== */
type DP = {
  id: number;
  bank_id: number;
  amount_net: number;
  username_snapshot: string | null;
  lead_name_snapshot: string | null;
  txn_at_opened?: string | null;
  txn_at_final: string;
  created_by: string | null;
};

type WD = {
  id: number;
  bank_id: number;
  amount_gross: number;
  transfer_fee_amount?: number | null; // nama kolom bisa "transfer_fee_amount" / "fee_amount" → ditangani di normalisasi
  fee_amount?: number | null;
  amount_net?: number | null; // bila ada
  username_snapshot: string | null;
  lead_name_snapshot: string | null;
  txn_at_opened?: string | null;
  txn_at_final: string;
  created_by: string | null;
};

type PDP = {
  id: number;
  bank_id: number;
  amount_net: number;
  txn_at_opened?: string | null;
  txn_at_final: string;
  created_by: string | null;
};

type ADJ = {
  id: number;
  bank_id: number;
  amount_delta: number; // signed
  description: string | null;
  txn_at_opened?: string | null;
  txn_at_final: string;
  created_at: string;
  created_by: string | null;
};

type EXP = {
  id: number;
  bank_id: number;
  amount: number; // NEGATIVE
  category_code: string | null;
  description: string | null;
  txn_at_opened?: string | null;
  txn_at_final: string;
  created_at: string;
  created_by: string | null;
};

type TT = {
  id: number;
  bank_from_id: number;
  bank_to_id: number;
  amount_gross: number;
  fee_amount: number;
  from_txn_at: string;
  to_txn_at: string;
  description: string | null;
  created_at: string;
  created_by: string | null;
};

/* ===== baris yang ditampilkan di Bank Mutation ===== */
type BMRow = {
  // urutan tampil
  clickAt: string;            // Waktu Click
  chosenAt: [string] | [string, string]; // Waktu Dipilih (1 baris atau 2 baris untuk TT)
  cat: string;                // kategori
  bankId: number;             // untuk filter label
  bankInfo: string;           // baris kedua di sel Bank (mis. "Depo dari username", "Transfer dari ...")
  desc: string;               // kolom Desc
  amount: number;             // signed net
  start?: number | null;      // reserved (placeholder)
  finish?: number | null;     // reserved (placeholder)
  creatorId: string | null;   // user id
  // metadata filter
  srcId: string;              // id asli dari tabel sumber (untuk "Cari ID")
};

/* ===== constants & helpers ===== */
const PAGE_SIZE = 100;
const startIsoJakarta = (d: string) => new Date(`${d}T00:00:00+07:00`).toISOString();
const endIsoJakarta   = (d: string) => new Date(`${d}T23:59:59.999+07:00`).toISOString();
const fmtJak = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

const CAT_OPTIONS = [
  "ALL",
  "Depo",
  "WD",
  "Pending DP",
  "Sesama CM",
  "Biaya Transaksi",
  "Adjustment",
  "Expense",
] as const;
type CatOpt = typeof CAT_OPTIONS[number];

/* ============================================= */

export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  // data
  const [rows, setRows] = useState<BMRow[]>([]);
  const [loading, setLoading] = useState(true);

  // dictionaries
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [byMap, setByMap] = useState<Record<string, string>>({});

  // filters (disusun supaya align ke kolom)
  const [fId, setFId] = useState<string>("");               // header ID
  const [fStart, setFStart] = useState<string>("");         // Waktu Click (Start)
  const [fFinish, setFFinish] = useState<string>("");       // Waktu Dipilih (Finish) → tetap dipakai sebagai batas kanan
  const [fCat, setFCat] = useState<CatOpt>("ALL");          // Cat
  const [fBank, setFBank] = useState<string>("ALL");        // Bank (id sebagai string atau "ALL")
  const [fDesc, setFDesc] = useState<string>("");           // Desc

  // pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // label bank lengkap "[CODE] name - no"
  const bankLabel = useMemo(() => {
    const map: Record<number, string> = {};
    for (const b of banks) map[b.id] = `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
    return (id: number) => map[id] ?? `#${id}`;
  }, [banks]);

  // full name of creator
  const creatorName = (uid: string | null) =>
    uid ? byMap[uid] ?? uid.slice(0, 8) : "-";

  // ===== load =====
  const load = async () => {
    setLoading(true);

    // batas waktu untuk query (berdasarkan Waktu Click)
    const s = fStart ? startIsoJakarta(fStart) : null;
    const e = fFinish ? endIsoJakarta(fFinish) : null;

    const rowsBM: BMRow[] = [];

    // ----- helper push (urutan & normalisasi) -----
    const pushRow = (r: BMRow) => rowsBM.push(r);

    // ----- Deposits -----
    {
      let q = supabase
        .from("deposits")
        .select(
          "id, bank_id, amount_net, username_snapshot, lead_name_snapshot, txn_at_opened, txn_at_final, created_by"
        )
        .order("txn_at_opened", { ascending: false });

      if (s) q = q.gte("txn_at_opened", s);
      if (e) q = q.lte("txn_at_opened", e);

      const { data } = await q;
      for (const d of (data as DP[] | null) ?? []) {
        // filter bank
        if (fBank !== "ALL" && String(d.bank_id) !== fBank) continue;
        const bankInfo =
          `Depo dari ${d.username_snapshot ?? d.lead_name_snapshot ?? "-"}`;
        pushRow({
          clickAt: d.txn_at_opened ?? d.txn_at_final,
          chosenAt: [d.txn_at_final],
          cat: "Depo",
          bankId: d.bank_id,
          bankInfo,
          desc: "",
          amount: Number(d.amount_net ?? 0),
          start: null,
          finish: null,
          creatorId: d.created_by ?? null,
          srcId: `DP-${d.id}`,
        });
      }
    }

    // ----- Withdrawals (+ baris biaya transaksi) -----
    {
      let q = supabase
        .from("withdrawals")
        .select(
          "id, bank_id, amount_gross, transfer_fee_amount, fee_amount, amount_net, username_snapshot, lead_name_snapshot, txn_at_opened, txn_at_final, created_by"
        )
        .order("txn_at_opened", { ascending: false });

      if (s) q = q.gte("txn_at_opened", s);
      if (e) q = q.lte("txn_at_opened", e);

      const { data } = await q;
      for (const w of (data as WD[] | null) ?? []) {
        if (fBank !== "ALL" && String(w.bank_id) !== fBank) continue;

        const fee =
          (w.transfer_fee_amount ?? w.fee_amount ?? 0) as number;
        const net =
          w.amount_net != null
            ? Number(w.amount_net)
            : 0 - Number(w.amount_gross ?? 0) - Number(fee ?? 0);

        const info = `WD dari ${w.username_snapshot ?? w.lead_name_snapshot ?? "-"}`;

        // baris WD (net)
        pushRow({
          clickAt: w.txn_at_opened ?? w.txn_at_final,
          chosenAt: [w.txn_at_final],
          cat: "WD",
          bankId: w.bank_id,
          bankInfo: info,
          desc: "",
          amount: net,
          start: null,
          finish: null,
          creatorId: w.created_by ?? null,
          srcId: `WD-${w.id}`,
        });

        // baris biaya transaksi (jika ada)
        if (fee && Number(fee) > 0) {
          pushRow({
            clickAt: w.txn_at_opened ?? w.txn_at_final,
            chosenAt: [w.txn_at_final],
            cat: "Biaya Transaksi",
            bankId: w.bank_id,
            bankInfo: info,
            desc: "Transfer fee (WD)",
            amount: 0 - Number(fee),
            start: null,
            finish: null,
            creatorId: w.created_by ?? null,
            srcId: `WD-FEE-${w.id}`,
          });
        }
      }
    }

    // ----- Pending Deposits (create) -----
    {
      let q = supabase
        .from("pending_deposits")
        .select("id, bank_id, amount_net, txn_at_opened, txn_at_final, created_by")
        .order("txn_at_opened", { ascending: false });

      if (s) q = q.gte("txn_at_opened", s);
      if (e) q = q.lte("txn_at_opened", e);

      const { data } = await q;
      for (const p of (data as PDP[] | null) ?? []) {
        if (fBank !== "ALL" && String(p.bank_id) !== fBank) continue;
        pushRow({
          clickAt: p.txn_at_opened ?? p.txn_at_final,
          chosenAt: [p.txn_at_final],
          cat: "Pending DP",
          bankId: p.bank_id,
          bankInfo: "Pending Deposit",
          desc: "",
          amount: Number(p.amount_net ?? 0),
          start: null,
          finish: null,
          creatorId: p.created_by ?? null,
          srcId: `PDP-${p.id}`,
        });
      }
    }

    // ----- Bank Adjustments -----
    {
      let q = supabase
        .from("bank_adjustments")
        .select("id, bank_id, amount_delta, description, txn_at_opened, txn_at_final, created_at, created_by")
        .order("created_at", { ascending: false });

      if (s) q = q.gte("created_at", s);
      if (e) q = q.lte("created_at", e);

      const { data } = await q;
      for (const a of (data as ADJ[] | null) ?? []) {
        if (fBank !== "ALL" && String(a.bank_id) !== fBank) continue;
        pushRow({
          clickAt: a.txn_at_opened ?? a.created_at,
          chosenAt: [a.txn_at_final],
          cat: "Adjustment",
          bankId: a.bank_id,
          bankInfo: a.description ?? "",
          desc: a.description ?? "",
          amount: Number(a.amount_delta ?? 0),
          start: null,
          finish: null,
          creatorId: a.created_by ?? null,
          srcId: `ADJ-${a.id}`,
        });
      }
    }

    // ----- Expenses -----
    {
      let q = supabase
        .from("bank_expenses")
        .select("id, bank_id, amount, category_code, description, txn_at_opened, txn_at_final, created_at, created_by")
        .order("created_at", { ascending: false });

      if (s) q = q.gte("created_at", s);
      if (e) q = q.lte("created_at", e);

      const { data } = await q;
      for (const x of (data as EXP[] | null) ?? []) {
        if (fBank !== "ALL" && String(x.bank_id) !== fBank) continue;
        pushRow({
          clickAt: x.txn_at_opened ?? x.created_at,
          chosenAt: [x.txn_at_final],
          cat: "Expense",
          bankId: x.bank_id,
          bankInfo: `${x.category_code ?? "-"}`,
          desc: x.description ?? "",
          amount: Number(x.amount ?? 0),
          start: null,
          finish: null,
          creatorId: x.created_by ?? null,
          srcId: `EXP-${x.id}`,
        });
      }
    }

    // ----- Interbank Transfers → 2 baris Sesama CM (+1 biaya transaksi) -----
    {
      let q = supabase
        .from("interbank_transfers")
        .select("*")
        .order("created_at", { ascending: false });

      if (s) q = q.gte("created_at", s);
      if (e) q = q.lte("created_at", e);

      const { data } = await q;
      for (const t of (data as TT[] | null) ?? []) {
        // baris FROM
        if (fBank === "ALL" || String(t.bank_from_id) === fBank) {
          pushRow({
            clickAt: t.created_at,
            chosenAt: [t.from_txn_at, t.to_txn_at],
            cat: "Sesama CM",
            bankId: t.bank_from_id,
            bankInfo: "Transfer dari bank asal ke bank tujuan",
            desc: t.description ?? "",
            amount: 0 - Number(t.amount_gross ?? 0),
            start: null,
            finish: null,
            creatorId: t.created_by ?? null,
            srcId: `TT-FROM-${t.id}`,
          });
        }
        // baris TO
        if (fBank === "ALL" || String(t.bank_to_id) === fBank) {
          pushRow({
            clickAt: t.created_at,
            chosenAt: [t.from_txn_at, t.to_txn_at],
            cat: "Sesama CM",
            bankId: t.bank_to_id,
            bankInfo: "Transfer dari bank asal ke bank tujuan",
            desc: t.description ?? "",
            amount: Number(t.amount_gross ?? 0),
            start: null,
            finish: null,
            creatorId: t.created_by ?? null,
            srcId: `TT-TO-${t.id}`,
          });
        }
        // biaya transfer (dibebankan di bank FROM)
        if (t.fee_amount && Number(t.fee_amount) > 0) {
          if (fBank === "ALL" || String(t.bank_from_id) === fBank) {
            pushRow({
              clickAt: t.created_at,
              chosenAt: [t.from_txn_at, t.to_txn_at],
              cat: "Biaya Transaksi",
              bankId: t.bank_from_id,
              bankInfo: "Transfer dari bank asal ke bank tujuan",
              desc: "Transfer fee (TT)",
              amount: 0 - Number(t.fee_amount),
              start: null,
              finish: null,
              creatorId: t.created_by ?? null,
              srcId: `TT-FEE-${t.id}`,
            });
          }
        }
      }
    }

    // ===== filter tambahan di memory (Cat & Desc & ID) =====
    let list = rowsBM;

    if (fCat !== "ALL") list = list.filter((x) => x.cat === fCat);
    if (fDesc.trim())
      list = list.filter(
        (x) =>
          x.desc.toLowerCase().includes(fDesc.toLowerCase()) ||
          x.bankInfo.toLowerCase().includes(fDesc.toLowerCase())
      );
    if (fId.trim()) {
      const q = fId.trim();
      list = list.filter((x) => x.srcId.includes(q));
    }

    // sort default: Waktu Click DESC, lalu srcId DESC (stabil)
    list.sort((a, b) => (a.clickAt < b.clickAt ? 1 : a.clickAt > b.clickAt ? -1 : (a.srcId < b.srcId ? 1 : -1)));

    // siapkan dictionaries (banks & creators) hanya untuk id yang terpakai
    const bankIds = Array.from(new Set(list.map((x) => x.bankId)));
    const byIds = Array.from(
      new Set(list.map((x) => x.creatorId).filter(Boolean) as string[])
    );

    // load banks (hanya yang dipakai)
    if (bankIds.length) {
      const { data: bankData } = await supabase
        .from("banks")
        .select("id, bank_code, account_name, account_no")
        .in("id", bankIds);
      setBanks((bankData as BankLite[]) ?? []);
    } else setBanks([]);

    // load creators
    let by: Record<string, string> = {};
    if (byIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", byIds);
      for (const p of (profs ?? []) as ProfileLite[]) {
        by[p.user_id] = p.full_name ?? p.user_id.slice(0, 8);
      }
    }
    setByMap(by);

    // pagination
    setTotal(list.length);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE;
    setRows(list.slice(from, to));

    setLoading(false);
  };

  useEffect(() => {
    // setiap open halaman → muat awal
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    setPage(1);
    load();
  };

  // pagination helpers
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const goFirst = () => canPrev && (setPage(1), load());
  const goPrev = () => canPrev && (setPage((p) => p - 1), load());
  const goNext = () => canNext && (setPage((p) => p + 1), load());
  const goLast = () => canNext && (setPage(totalPages), load());

  /* ============================ RENDER ============================ */

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1200px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* ===== Row FILTERS (posisi mengikuti urutan kolom) ===== */}
            <tr className="filters">
              {/* ID */}
              <th className="w-20">
                <input
                  placeholder="Cari ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              {/* Waktu Click (Start) */}
              <th className="w-56">
                <input
                  type="date"
                  value={fStart}
                  onChange={(e) => setFStart(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              {/* Waktu Dipilih (Finish) */}
              <th className="w-56">
                <input
                  type="date"
                  value={fFinish}
                  onChange={(e) => setFFinish(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              {/* Cat */}
              <th className="w-40">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value as CatOpt)}
                  className="w-full border rounded px-2 py-1"
                >
                  {CAT_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </th>
              {/* Bank */}
              <th>
                <select
                  value={fBank}
                  onChange={(e) => setFBank(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                >
                  <option value="ALL">ALL BANK</option>
                  {banks.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      [{b.bank_code}] {b.account_name} - {b.account_no}
                    </option>
                  ))}
                </select>
              </th>
              {/* Desc filter */}
              <th>
                <input
                  placeholder="Search desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                  className="w-full border rounded px-2 py-1"
                />
              </th>
              {/* Amount */}
              <th className="w-36"></th>
              {/* Start */}
              <th className="w-28"></th>
              {/* Finish */}
              <th className="w-28"></th>
              {/* Creator + Submit */}
              <th className="w-28 whitespace-nowrap">
                <button onClick={apply} className="rounded bg-blue-600 text-white px-3 py-1">
                  Submit
                </button>
              </th>
            </tr>

            {/* ===== Row HEADERS ===== */}
            <tr>
              <th className="text-left w-20">ID</th>
              <th className="text-left w-56">Waktu Click</th>
              <th className="text-left w-56">Waktu Dipilih</th>
              <th className="text-left w-40">Cat</th>
              <th className="text-left">Bank</th>
              <th className="text-left">Desc</th>
              <th className="text-left w-36">Amount</th>
              <th className="text-left w-28">Start</th>
              <th className="text-left w-28">Finish</th>
              <th className="text-left w-28">Creator</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10}>No data</td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={`${r.srcId}-${idx}`} className="hover:bg-gray-50">
                  {/* ID ordinal 1..n */}
                  <td>{(page - 1) * PAGE_SIZE + idx + 1}</td>

                  {/* Waktu Click */}
                  <td>{fmtJak(r.clickAt)}</td>

                  {/* Waktu Dipilih (1 baris atau 2 baris) */}
                  <td className="whitespace-normal break-words">
                    {r.chosenAt.length === 1 ? (
                      <div>{fmtJak(r.chosenAt[0])}</div>
                    ) : (
                      <>
                        <div>{fmtJak(r.chosenAt[0])}</div>
                        <div>{fmtJak(r.chosenAt[1])}</div>
                      </>
                    )}
                  </td>

                  {/* Cat */}
                  <td>{r.cat}</td>

                  {/* Bank (label lengkap + garis pemisah + info unik) */}
                  <td className="whitespace-normal break-words">
                    <div className="font-medium">{bankLabel(r.bankId)}</div>
                    <div className="border-t my-1" />
                    <div className="text-[13px]">{r.bankInfo}</div>
                  </td>

                  {/* Desc */}
                  <td className="whitespace-normal break-words">{r.desc}</td>

                  {/* Amount */}
                  <td>{formatAmount(r.amount)}</td>

                  {/* Start/Finish placeholder */}
                  <td>—</td>
                  <td>—</td>

                  {/* Creator */}
                  <td>{creatorName(r.creatorId)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button onClick={goFirst} disabled={!canPrev} className="px-3 py-1 rounded border bg-white disabled:opacity-50">
            First
          </button>
          <button onClick={goPrev} disabled={!canPrev} className="px-3 py-1 rounded border bg-white disabled:opacity-50">
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">Page {page} / {totalPages}</span>
          <button onClick={goNext} disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">
            Next
          </button>
          <button onClick={goLast} disabled={!canNext} className="px-3 py-1 rounded border bg-white disabled:opacity-50">
            Last
          </button>
        </nav>
      </div>
    </div>
  );
}
