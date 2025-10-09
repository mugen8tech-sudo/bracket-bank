"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/* =========================
   T Y P E S
   ========================= */

type BankLite = {
  id: number;
  bank_code: string;
  account_name: string;
  account_no: string;
};

type ProfileLite = {
  user_id: string;
  full_name: string | null;
};

type Row = {
  // kolom tabel mutasi
  // (ID hanya tampilan, dihitung dari urutan tsClick di halaman)
  tsClick: string; // waktu klik / created_at
  tsPickTop?: string | null; // waktu final (atas)
  tsPickBottom?: string | null; // waktu final (bawah) – khusus TT (to)
  cat:
    | "Depo"
    | "WD"
    | "Pending DP"
    | "Sesama CM"
    | "Adjustment"
    | "Expense";
  bankTop: string; // [CODE] NAME - NO
  bankSub?: string; // keterangan di bawah label bank
  desc?: string | null; // kolom deskripsi
  amount: number; // jumlah (net utk DP/PDP/Adj/Expense, negatif utk WD & fee TT out)
  start: number | null; // running balance sebelum
  finish: number | null; // running balance sesudah
  by: string; // creator
};

type LeadSlim = { username: string | null; bank_name: string | null };

type DepositRow = {
  id: number;
  bank_id: number;
  amount_net: number;
  username_snapshot: string;
  lead_bank_snapshot: string | null;
  lead_accno_snapshot: string | null;
  txn_at_opened: string; // waktu klik
  txn_at_final: string;  // waktu dipilih
  created_by: string | null;
  // kolom baru:
  balance_before?: number | null;
  balance_after?: number | null;
};

type WithdrawalRow = {
  id: number;
  bank_id: number;
  amount_gross: number;
  username_snapshot: string
  bank_name: string;
  txn_at_opened: string;
  txn_at_final: string;
  created_by: string | null;
  // kolom baru:
  balance_before?: number | null;
  balance_after?: number | null;
};

type PendingDepositRow = {
  id: number;
  bank_id: number;
  amount_net: number;
  description: string | null;
  txn_at_opened: string;
  txn_at_final: string;
  is_assigned: boolean;
  assigned_username_snapshot: string | null;
  assigned_at: string | null;
  created_by: string | null;
  // kolom baru:
  balance_before?: number | null;
  balance_after?: number | null;
};

type TT = {
  id: number;
  bank_from_id: number;
  bank_to_id: number;
  amount_gross: number;
  fee_amount: number;
  description: string | null;
  from_txn_at: string;
  to_txn_at: string;
  created_at: string;
  created_by: string | null;
  // kolom baru (opsional – aman jika belum ada di DB):
  from_balance_before?: number | null;
  from_balance_after?: number | null;
  to_balance_before?: number | null;
  to_balance_after?: number | null;
};

type AdjustmentRow = {
  id: number;
  bank_id: number;
  amount_delta: number;
  description: string | null;
  txn_at_final: string;
  created_at: string;
  created_by: string | null;
  balance_before?: number | null;
  balance_after?: number | null;
};

type ExpenseRow = {
  id: number;
  bank_id: number;
  amount: number; // negatif
  category_code: string | null;
  description: string | null;
  txn_at_final: string;
  created_at: string;
  created_by: string | null;
  balance_before?: number | null;
  balance_after?: number | null;
};

/* =========================
   C O N S T
   ========================= */

const PAGE_SIZE = 25;

type LeadSlim = { username: string | null; bank_name: string | null };

/* =========================
   U T I L
   ========================= */

const toIsoStartJakarta = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toISOString();
const toIsoEndJakarta = (d: string) =>
  new Date(`${d}T23:59:59.999+07:00`).toISOString();

function fmtDateJak(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

/* =========================
   C O M P O N E N T
   ========================= */

export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  // options bank utk filter + label
  const [bankList, setBankList] = useState<BankLite[]>([]);
  const bankMap = useMemo(() => {
    const m = new Map<number, BankLite>();
    bankList.forEach((b) => m.set(b.id, b));
    return m;
  }, [bankList]);

  const labelBank = (id: number) => {
    const b = bankMap.get(id);
    return b ? `[${b.bank_code}] ${b.account_name} - ${b.account_no}` : `#${id}`;
  };

  // data utama
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  // filters (sesuai versi yang sudah cocok sebelumnya)
  const [fClickStart, setFClickStart] = useState("");
  const [fClickFinish, setFClickFinish] = useState("");
  const [fCat, setFCat] = useState<"" | "Depo" | "WD" | "Pending DP" | "Sesama CM" | "Adjustment" | "Expense">("");
  const [fBankId, setFBankId] = useState<"" | number>("");
  const [fDesc, setFDesc] = useState("");

  // pagination
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  // who created (map user_id -> full_name)
  const [whoMap, setWhoMap] = useState<Record<string, string>>({});

  const apply = async (silent?: boolean) => {
    if (!silent) setLoading(true);

    // ----- load bank (untuk filter & label) -----
    const { data: bdata } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no")
      .order("id", { ascending: true });
    setBankList((bdata as BankLite[]) ?? []);

    // ----- build filter waktu klik -----
    const hasStart = !!fClickStart;
    const hasFinish = !!fClickFinish;
    const sISO = hasStart ? toIsoStartJakarta(fClickStart) : undefined;
    const eISO = hasFinish ? toIsoEndJakarta(fClickFinish) : undefined;

    const bankIdFilter = fBankId === "" ? undefined : Number(fBankId);

    // ===== ambil data per sumber =====
    const [
      depResp,
      wdResp,
      pdpResp,
      ttResp,
      adjResp,
      expResp,
    ] = await Promise.all([
      (async () => {
        let q = supabase
          .from("deposits")
          .select(
            "id, bank_id, amount_net, username_snapshot, lead_bank_snapshot, lead_accno_snapshot, txn_at_opened, txn_at_final, created_by, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        if (hasStart) q = q.gte("txn_at_opened", sISO!);
        if (hasFinish) q = q.lte("txn_at_opened", eISO!);
        // GUARD: DP yang tidak punya snapshot bank/accno di-lead (kasus Assign PDP dobel)
        q = q.not("lead_bank_snapshot", "is", null)
             .not("lead_accno_snapshot", "is", null);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as DepositRow[]) ?? [];
      })(),
      (async () => {
        let q = supabase
          .from("withdrawals")
          .select(
            "id, bank_id, amount_gross, username_snapshot, txn_at_opened, txn_at_final, created_by, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        if (hasStart) q = q.gte("txn_at_opened", sISO!);
        if (hasFinish) q = q.lte("txn_at_opened", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as WithdrawalRow[]) ?? [];
      })(),
      (async () => {
        let q = supabase
          .from("pending_deposits")
          .select(
            "id, bank_id, amount_net, description, txn_at_opened, txn_at_final, is_assigned, assigned_username_snapshot, assigned_at, created_by, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        // Untuk baris "Pending DP" → filter pakai txn_at_opened.
        // Untuk baris "Depo dari PDP (assign)" → filter pakai assigned_at (di-mapping di bawah).
        if (hasStart) q = q.gte("txn_at_opened", sISO!);
        if (hasFinish) q = q.lte("txn_at_opened", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as PendingDepositRow[]) ?? [];
      })(),
      (async () => {
        let q = supabase
          .from("interbank_transfers")
          .select(
            "id, bank_from_id, bank_to_id, amount_gross, fee_amount, description, from_txn_at, to_txn_at, created_at, created_by, from_balance_before, from_balance_after, to_balance_before, to_balance_after"
          )
          .order("created_at", { ascending: false });
        // filter menggunakan created_at (waktu klik)
        if (hasStart) q = q.gte("created_at", sISO!);
        if (hasFinish) q = q.lte("created_at", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as TT[]) ?? [];
      })(),
      (async () => {
        let q = supabase
          .from("bank_adjustments")
          .select(
            "id, bank_id, amount_delta, description, txn_at_final, created_at, created_by, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        if (hasStart) q = q.gte("created_at", sISO!);
        if (hasFinish) q = q.lte("created_at", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as AdjustmentRow[]) ?? [];
      })(),
      (async () => {
        let q = supabase
          .from("bank_expenses")
          .select(
            "id, bank_id, amount, category_code, description, txn_at_final, created_at, created_by, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        if (hasStart) q = q.gte("created_at", sISO!);
        if (hasFinish) q = q.lte("created_at", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as ExpenseRow[]) ?? [];
      })(),
    ]);

    // ===== ambil nama "by" (created_by -> full_name) =====
    const byIds = new Set<string>();
    depResp.forEach((x) => x.created_by && byIds.add(x.created_by));
    wdResp.forEach((x) => x.created_by && byIds.add(x.created_by));
    pdpResp.forEach((x) => x.created_by && byIds.add(x.created_by));
    ttResp.forEach((x) => x.created_by && byIds.add(x.created_by));
    adjResp.forEach((x) => x.created_by && byIds.add(x.created_by));
    expResp.forEach((x) => x.created_by && byIds.add(x.created_by));

    const byMap: Record<string, string> = {};
    if (byIds.size) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", Array.from(byIds));
      (profs as ProfileLite[] | null)?.forEach((p) => {
        byMap[p.user_id] = p.full_name ?? p.user_id.slice(0, 8);
      });
    }
    setWhoMap(byMap);

    // ===== mapping ke baris mutasi =====
    const result: Row[] = [];

    // Depo
    // (sudah ada GUARD: hanya DP yang memiliki snapshot bank di leads yang masuk)
    for (const r of depResp) {
      if (fCat && fCat !== "Depo") continue;
      const uname = r.username_snapshot ?? "-";
      const bname = String(r.lead_bank_snapshot ?? "-");
      result.push({
        tsClick: r.txn_at_opened,
        tsPickTop: r.txn_at_final,
        cat: "Depo",
        bankTop: labelBank(r.bank_id),
        bankSub: `Depo dari ${uname} / ${bname}`,
        desc: "—",
        amount: +Number(r.amount_net || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        by: r.created_by ? byMap[r.created_by] : "-",
      });
    }

    // Depo dari PDP (Assign) → ikut Cat "Depo", waktunya:
    // - Waktu Click   = assigned_at
    // - Waktu Dipilih = txn_at_final (kolom PDP)
    // - Player        = assigned_username_snapshot
    // - Bank name     = ambil dari leads (map username → bank_name)
    const unameSet = new Set<string>();
    pdpResp.forEach((r) => r.assigned_username_snapshot && unameSet.add(r.assigned_username_snapshot));
    const unameMap: Record<string, string> = {};
    if (unameSet.size) {
      const { data: leads } = await supabase
        .from("leads")
        .select("username, bank_name")
        .in("username", Array.from(unameSet));
      (leads as LeadSlim[] | null)?.forEach((l) => {
        if (!l.username) return;
        unameMap[l.username] = l.bank_name ?? "-";
      });
    }
    for (const r of pdpResp) {
      if (!r.is_assigned || !r.assigned_at) continue;
      if (fCat && fCat !== "Depo") continue;

      // filter waktu klik khusus rute ini pakai assigned_at (di luar query awal)
      if (hasStart && r.assigned_at < sISO!) continue;
      if (hasFinish && r.assigned_at > eISO!) continue;

      const uname = r.assigned_username_snapshot ?? "-";
      const bname = unameMap[uname] ?? "-";
      result.push({
        tsClick: r.assigned_at,
        tsPickTop: r.txn_at_final,
        cat: "Depo",
        bankTop: labelBank(r.bank_id),
        bankSub: `Depo dari ${uname} / ${bname}`,
        desc: "—",
        amount: +Number(r.amount_net || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        by: r.created_by ? byMap[r.created_by] : "-",
      });
    }

    // Pending DP (tetap ada, tidak dihapus meski sudah assign)
    for (const r of pdpResp) {
      if (fCat && fCat !== "Pending DP") continue;
      result.push({
        tsClick: r.txn_at_opened,
        tsPickTop: r.txn_at_final,
        cat: "Pending DP",
        bankTop: labelBank(r.bank_id),
        bankSub: "Pending Deposit",
        desc: r.description ?? "—",
        amount: +Number(r.amount_net || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        by: r.created_by ? byMap[r.created_by] : "-",
      });
    }

    // WD
    for (const r of wdResp) {
      if (fCat && fCat !== "WD") continue;
      // tambah bank_name sesuai permintaan
      const uname = r.username_snapshot ?? "-";
      const bname = r.bank_name ?? "-";
      result.push({
        tsClick: r.txn_at_opened,
        tsPickTop: r.txn_at_final,
        cat: "WD",
        bankTop: labelBank(r.bank_id),
        bankSub: `WD dari ${uname} / ${bname}`,
        desc: "—",
        amount: -Number(r.amount_gross || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        by: r.created_by ? byMap[r.created_by] : "-",
      });
    }

    // TT (Sesama CM) → 2 baris
    for (const r of ttResp) {
      // filter bank di level baris karena ada 2 bank
      const includeFrom = !bankIdFilter || r.bank_from_id === bankIdFilter;
      const includeTo = !bankIdFilter || r.bank_to_id === bankIdFilter;
      if (includeFrom) {
        if (!fCat || fCat === "Sesama CM") {
          result.push({
            tsClick: r.created_at, // waktu klik
            tsPickTop: r.from_txn_at, // atas = from
            tsPickBottom: r.to_txn_at, // bawah = to
            cat: "Sesama CM",
            bankTop: labelBank(r.bank_from_id),
            bankSub: `Transfer dari ${labelBank(r.bank_from_id).split("] ")[0].replace("[","")} ke ${labelBank(r.bank_to_id).split("] ")[0].replace("[","")}`,
            desc: "—",
            amount: -Number(r.amount_gross || 0),
            start: (r as any).from_balance_before ?? null,
            finish: (r as any).from_balance_after ?? null,
            by: r.created_by ? byMap[r.created_by] : "-",
          });
        }
      }
      if (includeTo) {
        if (!fCat || fCat === "Sesama CM") {
          result.push({
            tsClick: r.created_at,
            tsPickTop: r.from_txn_at,
            tsPickBottom: r.to_txn_at,
            cat: "Sesama CM",
            bankTop: labelBank(r.bank_to_id),
            bankSub: `Transfer dari ${labelBank(r.bank_from_id).split("] ")[0].replace("[","")} ke ${labelBank(r.bank_to_id).split("] ")[0].replace("[","")}`,
            desc: "—",
            amount: +Number(r.amount_gross || 0),
            start: (r as any).to_balance_before ?? null,
            finish: (r as any).to_balance_after ?? null,
            by: r.created_by ? byMap[r.created_by] : "-",
          });
        }
      }
    }

    // Adjustment
    for (const r of adjResp) {
      if (fCat && fCat !== "Adjustment") continue;
      result.push({
        tsClick: r.created_at,
        tsPickTop: r.txn_at_final,
        cat: "Adjustment",
        bankTop: labelBank(r.bank_id),
        bankSub: r.description ?? "",
        desc: r.description ?? "—",
        amount: +Number(r.amount_delta || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        by: r.created_by ? byMap[r.created_by] : "-",
      });
    }

    // Expense
    for (const r of expResp) {
      if (fCat && fCat !== "Expense") continue;
      result.push({
        tsClick: r.created_at,
        tsPickTop: r.txn_at_final,
        cat: "Expense",
        bankTop: labelBank(r.bank_id),
        bankSub: r.category_code ?? "",
        desc: r.description ?? "—",
        amount: -Number(r.amount || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        by: r.created_by ? byMap[r.created_by] : "-",
      });
    }

    // filter "Search desc"
    const filtered = fDesc.trim()
      ? result.filter((r) => {
          const hay =
            (r.desc ?? "") +
            " " +
            (r.bankSub ?? "") +
            " " +
            (r.bankTop ?? "");
          return hay.toLowerCase().includes(fDesc.trim().toLowerCase());
        })
      : result;

    // sort: ID dari timestamp seluruh transaksi (klik) → terbaru paling atas
    filtered.sort((a, b) => (a.tsClick > b.tsClick ? -1 : a.tsClick < b.tsClick ? 1 : 0));

    setRows(filtered);
    setLoading(false);
  };

  useEffect(() => {
    apply(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const displayNumber = (idxOnPage: number) =>
    pageRows.length - idxOnPage; // 9..1 di halaman (sesuai contohmu)

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* Row FILTERS */}
            <tr className="filters">
              {/* ID + tombol Cari */}
              <th className="w-16">
                <button
                  className="border rounded px-2 py-1 text-xs"
                  onClick={() => apply(true)}
                  title="Cari (apply filter)"
                >
                  Cari
                </button>
              </th>

              {/* Waktu Click (atas=batas awal, bawah=batas akhir) */}
              <th className="w-44">
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fClickStart}
                    onChange={(e) => setFClickStart(e.target.value)}
                    className="border rounded px-2 py-1"
                  />
                  <input
                    type="date"
                    value={fClickFinish}
                    onChange={(e) => setFClickFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                  />
                </div>
              </th>

              {/* Waktu Dipilih (tidak ada filter – kolom ini dikunci lebar) */}
              <th className="w-44"></th>

              {/* Cat */}
              <th className="w-28">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value as any)}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="">ALL</option>
                  <option value="Sesama CM">Sesama CM</option>
                  <option value="Depo">Depo</option>
                  <option value="Pending DP">Pending DP</option>
                  <option value="WD">WD</option>
                  <option value="Adjustment">Adjustment</option>
                  <option value="Expense">Expense</option>
                </select>
              </th>

              {/* Bank */}
              <th>
                <select
                  value={fBankId === "" ? "" : String(fBankId)}
                  onChange={(e) =>
                    setFBankId(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="">ALL BANK</option>
                  {bankList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {[b.bank_code]} {b.account_name} - {b.account_no}
                    </option>
                  ))}
                </select>
              </th>

              {/* Search desc */}
              <th>
                <input
                  placeholder="Search desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </th>

              <th className="whitespace-nowrap">
                <button
                  onClick={() => apply()}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  Submit
                </button>
              </th>
            </tr>

            {/* HEADER */}
            <tr>
              <th className="text-left w-16">ID</th>
              <th className="text-left w-44">Waktu Click</th>
              <th className="text-left w-44">Waktu Dipilih</th>
              <th className="text-left w-28">Cat</th>
              <th className="text-left min-w-[320px]">Bank</th>
              <th className="text-left min-w-[220px]">Desc</th>
              <th className="text-left w-36">Amount</th>
              <th className="text-left w-36">Start</th>
              <th className="text-left w-36">Finish</th>
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
              pageRows.map((r, idx) => (
                <tr key={`${r.tsClick}-${idx}`} className="hover:bg-gray-50">
                  {/* ID diturunkan dari urutan di halaman */}
                  <td>{displayNumber(idx)}</td>
                  <td>
                    {fmtDateJak(r.tsClick)}
                  </td>
                  <td>
                    <div>{fmtDateJak(r.tsPickTop)}</div>
                    {r.tsPickBottom ? <div>{fmtDateJak(r.tsPickBottom)}</div> : null}
                  </td>
                  <td>{r.cat}</td>
                  <td className="whitespace-normal break-words">
                    <div className="font-semibold">{r.bankTop}</div>
                    {r.bankSub && (
                      <>
                        <div className="border-t my-1"></div>
                        <div>{r.bankSub}</div>
                      </>
                    )}
                  </td>
                  <td className="whitespace-normal break-words">{r.desc ?? "—"}</td>
                  <td className="text-left">{formatAmount(r.amount)}</td>
                  <td className="text-left">{r.start == null ? "—" : formatAmount(r.start)}</td>
                  <td className="text-left">{r.finish == null ? "—" : formatAmount(r.finish)}</td>
                  <td>{r.by}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* pagination 25 */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button
            onClick={() => { if (page > 1) setPage(1); }}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => { if (page > 1) setPage(page - 1); }}
            disabled={page <= 1}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => { if (page < totalPages) setPage(page + 1); }}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => { if (page < totalPages) setPage(totalPages); }}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>
    </div>
  );
}
