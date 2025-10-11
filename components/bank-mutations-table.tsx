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

type ProfileLite = { user_id: string; full_name: string | null };

type DepositRow = {
  id: number;
  bank_id: number;
  amount_net: number;
  username_snapshot: string;
  bank_name: string;
  lead_bank_snapshot: string | null;
  lead_accno_snapshot: string | null;
  txn_at_opened: string; // waktu klik
  txn_at_final: string;  // waktu dipilih
  created_by: string | null;
  created_by_name?: string | null;
  balance_before?: number | null;
  balance_after?: number | null;
};

type WithdrawalRow = {
  id: number;
  bank_id: number;
  amount_gross: number;
  transfer_fee_amount?: number | null; // fee WD
  username_snapshot: string;
  bank_name: string;
  txn_at_opened: string;
  txn_at_final: string;
  created_by: string | null;
  created_by_name?: string | null;
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
  created_by_name?: string | null;
  balance_before?: number | null;
  balance_after?: number | null;
};

type InterbankRow = {
  id: number;
  bank_from_id: number;
  bank_to_id: number;
  amount_gross: number;
  fee_amount?: number | null; // fee TT
  from_txn_at: string;
  to_txn_at: string;
  created_at: string;
  created_by: string | null;
  created_by_name?: string | null;
  from_balance_before?: number | null;
  from_balance_after?: number | null;   // biasanya belum potong fee
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
  created_by_name?: string | null;
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
  created_by_name?: string | null;
  balance_before?: number | null;
  balance_after?: number | null;
};

type LeadSlim = { username: string | null; bank_name: string | null };

/* =========================
   U T I L
   ========================= */

const toIsoStartJakarta = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toISOString();
const toIsoEndJakarta = (d: string) =>
  new Date(`${d}T23:59:59.999+07:00`).toISOString();

function fmtDateJak(s?: string | null) {
  if (!s) return "-";
  return new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

/* unified row untuk tabel */
type Row = {
  bankId: number;              // grouping per bank
  tsClick: string;             // utk sort/ID (desc)
  tsPickTop?: string | null;
  tsPickBottom?: string | null;
  cat: string;
  bankTop: string;
  bankSub?: string | null;
  desc?: string | null;
  amount: number;              // signed (+ masuk, âˆ’ keluar)
  // Start/Finish akan diisi oleh pass kalkulasi
  start?: number | null;
  finish?: number | null;
  // flag untuk running balance (Pending DP tidak memengaruhi saldo)
  affectsBalance: boolean;
  by?: string | null;
};

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

  // === PAGINATION (25 baris) ===
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const startIdx = (page - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  const pageRows = useMemo(() => rows.slice(startIdx, endIdx), [rows, startIdx, endIdx]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (page > tp) setPage(tp);
  }, [rows, page]);

  // filters
  const [fClickStart, setFClickStart] = useState("");
  const [fClickFinish, setFClickFinish] = useState("");
  const [fCat, setFCat] = useState<
    "" | "Depo" | "WD" | "Pending DP" | "Sesama CM" | "Biaya Transfer" | "Adjustment" | "Expense"
  >("");
  const [fBankId, setFBankId] = useState<"" | number>("");
  const [fDesc, setFDesc] = useState("");

  // who map
  const [whoMap, setWhoMap] = useState<Record<string, string>>({});

  // username -> bank_name (untuk DP/WD)
  const [uname2BankName, setUname2BankName] = useState<Record<string, string>>({});

  // load banks once (label dropdown)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("banks")
        .select("id, bank_code, account_name, account_no")
        .order("id", { ascending: true });
      setBankList((data as BankLite[]) ?? []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async () => {
    setLoading(true);

    // range waktu utk Waktu Click
    const hasStart = !!fClickStart;
    const hasFinish = !!fClickFinish;
    const sISO = hasStart ? toIsoStartJakarta(fClickStart) : undefined;
    const eISO = hasFinish ? toIsoEndJakarta(fClickFinish) : undefined;

    // bank filter
    const bankIdFilter = fBankId && typeof fBankId === "number" ? fBankId : null;

    // ===== ambil semua sumber =====
    const [depResp, wdResp, pdpResp, ttResp, adjResp, expResp] = await Promise.all([
      // Deposits
      (async () => {
        let q = supabase
          .from("deposits")
          .select(
            "id, bank_id, amount_net, username_snapshot, lead_bank_snapshot, lead_accno_snapshot, txn_at_opened, txn_at_final, created_by, created_by_name, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        if (hasStart) q = q.gte("txn_at_opened", sISO!);
        if (hasFinish) q = q.lte("txn_at_opened", eISO!);
        q = q.not("lead_bank_snapshot", "is", null).not("lead_accno_snapshot", "is", null);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as DepositRow[]) ?? [];
      })(),
      // Withdrawals (+ transfer_fee_amount)
      (async () => {
        let q = supabase
          .from("withdrawals")
          .select(
            "id, bank_id, amount_gross, transfer_fee_amount, username_snapshot, txn_at_opened, txn_at_final, created_by, created_by_name, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        if (hasStart) q = q.gte("txn_at_opened", sISO!);
        if (hasFinish) q = q.lte("txn_at_opened", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as WithdrawalRow[]) ?? [];
      })(),
      // Pending Deposits
      (async () => {
        let q = supabase
          .from("pending_deposits")
          .select(
            "id, bank_id, amount_net, description, txn_at_opened, txn_at_final, is_assigned, assigned_username_snapshot, assigned_at, created_by, created_by_name, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        // "Pending DP" â†’ filter pakai txn_at_opened; "Depo dari PDP (assign)" â†’ filter assigned_at saat mapping.
        if (hasStart) q = q.gte("txn_at_opened", sISO!);
        if (hasFinish) q = q.lte("txn_at_opened", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as PendingDepositRow[]) ?? [];
      })(),
      // Interbank Transfers (+ fee_amount)
      (async () => {
        let q = supabase
          .from("interbank_transfers")
          .select(
            "id, bank_from_id, bank_to_id, amount_gross, fee_amount, from_txn_at, to_txn_at, created_at, created_by, created_by_name, from_balance_before, from_balance_after, to_balance_before, to_balance_after"
          );
        if (hasStart) q = q.gte("created_at", sISO!); // waktu click
        if (hasFinish) q = q.lte("created_at", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as InterbankRow[]) ?? [];
      })(),
      // Adjustments
      (async () => {
        let q = supabase
          .from("bank_adjustments")
          .select(
            "id, bank_id, amount_delta, description, txn_at_final, created_at, created_by, created_by_name, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        if (hasStart) q = q.gte("created_at", sISO!);
        if (hasFinish) q = q.lte("created_at", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as AdjustmentRow[]) ?? [];
      })(),
      // Expenses
      (async () => {
        let q = supabase
          .from("bank_expenses")
          .select(
            "id, bank_id, amount, category_code, description, txn_at_final, created_at, created_by_name, created_by, balance_before, balance_after"
          );
        if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
        if (hasStart) q = q.gte("created_at", sISO!);
        if (hasFinish) q = q.lte("created_at", eISO!);
        const { data, error } = await q;
        if (error) console.error(error);
        return (data as ExpenseRow[]) ?? [];
      })(),
    ]);

    // ===== ambil bank_name player utk DP/WD/Depo dari PDP =====
    const usernames = new Set<string>();
    depResp.forEach((x) => x.username_snapshot && usernames.add(x.username_snapshot));
    wdResp.forEach((x) => x.username_snapshot && usernames.add(x.username_snapshot));
    pdpResp.forEach((x) => x.assigned_username_snapshot && usernames.add(x.assigned_username_snapshot));
    const unameMap: Record<string, string> = {};
    if (usernames.size) {
      const { data: leads } = await supabase
        .from("leads")
        .select("username, bank_name")
        .in("username", Array.from(usernames));
      (leads as LeadSlim[] | null)?.forEach((l) => {
        if (l.username) unameMap[l.username] = l.bank_name ?? "-";
      });
    }
    setUname2BankName(unameMap);

    // ===== mapping awal (Start/Finish dihitung pada pass akhir) =====
    const result: Row[] = [];

    // DP (langsung)
    for (const r of depResp) {
      if (fCat && fCat !== "Depo") continue;
      const uname = r.username_snapshot ?? "-";
      const bname = unameMap[uname] ?? "-";
      result.push({
        bankId: r.bank_id,
        tsClick: r.txn_at_opened,
        tsPickTop: r.txn_at_final,
        cat: "Depo",
        bankTop: labelBank(r.bank_id),
        bankSub: `Depo dari ${uname} / ${bname}`,
        desc: r.description ?? "-",
        amount: +Number(r.amount_net || 0),
        affectsBalance: true,
        by: r.created_by_name ?? "-",
      });
    }

    // Depo dari PDP (assign)
    for (const r of pdpResp) {
      if (!r.is_assigned || !r.assigned_at) continue;
      if (fCat && fCat !== "Depo") continue;
      if (hasStart && r.assigned_at < sISO!) continue; // filter click via assigned_at
      if (hasFinish && r.assigned_at > eISO!) continue;

      const uname = r.assigned_username_snapshot ?? "-";
      const bname = unameMap[uname] ?? "-";
      result.push({
        bankId: r.bank_id,
        tsClick: r.assigned_at,
        tsPickTop: r.txn_at_final,
        cat: "Depo",
        bankTop: labelBank(r.bank_id),
        bankSub: `Depo dari ${uname} / ${bname}`,
        desc: r.description ?? "-",
        amount: +Number(r.amount_net || 0),
        affectsBalance: true,
        by: r.created_by_name ?? "-",
      });
    }

    // Pending DP (tidak memengaruhi running balance â€“ tampil pakai snapshot bila ada)
    for (const r of pdpResp) {
      if (fCat && fCat !== "Pending DP") continue;
      result.push({
        bankId: r.bank_id,
        tsClick: r.txn_at_opened,
        tsPickTop: r.txn_at_final,
        cat: "Pending DP",
        bankTop: labelBank(r.bank_id),
        bankSub: "Pending Deposit",
        desc: r.description ?? "-",
        amount: +Number(r.amount_net || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        affectsBalance: false,
        by: r.created_by_name ?? "-",
      });
    }

    // WD (+ Biaya Transfer bila ada) - Opsi A
    for (const r of wdResp) {
      const uname = r.username_snapshot ?? "-";
      const bname = unameMap[uname] ?? "-";
      const gross = Number(r.amount_gross || 0);
      const fee = Number(r.transfer_fee_amount || 0);

      // Baris Biaya Transfer (WD)
      if (fee > 0 && (!fCat || fCat === "Biaya Transfer")) {
        result.push({
          bankId: r.bank_id,
          tsClick: r.txn_at_opened,
          tsPickTop: r.txn_at_final,
          cat: "Biaya Transfer",
          bankTop: labelBank(r.bank_id),
          bankSub: `WD dari ${uname} / ${bname}`,
          desc: r.description ?? "-",
          amount: -fee,
          affectsBalance: true,
          by: r.created_by_name ?? "-",
        });
      }

      // Baris WD
      if (!fCat || fCat === "WD") {
        result.push({
          bankId: r.bank_id,
          tsClick: r.txn_at_opened,
          tsPickTop: r.txn_at_final,
          cat: "WD",
          bankTop: labelBank(r.bank_id),
          bankSub: `WD dari ${uname} / ${bname}`,
          desc: r.description ?? "-",
          amount: -gross,
          affectsBalance: true,
          by: r.created_by_name ?? "-",
        });
      }
    }

    // TT (Sesama CM) - tampil: TO â†’ FEE â†’ FROM (ID terbaru di atas) - Opsi A
    for (const r of ttResp) {
      const includeFrom = !bankIdFilter || r.bank_from_id === bankIdFilter;
      const includeTo   = !bankIdFilter || r.bank_to_id   === bankIdFilter;

      const fromLabel = labelBank(r.bank_from_id);
      const toLabel   = labelBank(r.bank_to_id);

      const gross = Number(r.amount_gross || 0);
      const fee   = Number(r.fee_amount || 0);

      // TO (kredit) - bank penerima
      if (includeTo && (!fCat || fCat === "Sesama CM")) {
        result.push({
          bankId: r.bank_to_id,
          tsClick: r.created_at,
          tsPickTop: r.from_txn_at,
          tsPickBottom: r.to_txn_at,
          cat: "Sesama CM",
          bankTop: toLabel, // penerima
          bankSub: `Transfer dari ${fromLabel} ke ${toLabel}`,
          desc: r.description ?? "-",
          amount: +gross,
          affectsBalance: true,
          by: r.created_by_name ?? "-",
        });
      }

      // Biaya Transfer (TT) - didebet di bank FROM
      if (includeFrom && fee > 0 && (!fCat || fCat === "Biaya Transfer")) {
        result.push({
          bankId: r.bank_from_id,
          tsClick: r.created_at,
          tsPickTop: r.from_txn_at,
          cat: "Biaya Transfer",
          bankTop: fromLabel,
          bankSub: `Transfer dari ${fromLabel} ke ${toLabel}`,
          desc: r.description ?? "-",
          amount: -fee,
          affectsBalance: true,
          by: r.created_by_name ?? "-",
        });
      }

      // FROM (debit)
      if (includeFrom && (!fCat || fCat === "Sesama CM")) {
        result.push({
          bankId: r.bank_from_id,
          tsClick: r.created_at,
          tsPickTop: r.from_txn_at,
          tsPickBottom: r.to_txn_at,
          cat: "Sesama CM",
          bankTop: fromLabel,
          bankSub: `Transfer dari ${fromLabel} ke ${toLabel}`,
          desc: r.description ?? "-",
          amount: -gross,
          affectsBalance: true,
          by: r.created_by_name ?? "-",
        });
      }
    }

    // Adjustment
    for (const r of adjResp) {
      if (fCat && fCat !== "Adjustment") continue;
      result.push({
        bankId: r.bank_id,
        tsClick: r.created_at,
        tsPickTop: r.txn_at_final,
        cat: "Adjustment",
        bankTop: labelBank(r.bank_id),
        bankSub: r.description ?? "",
        desc: r.description ?? "-",
        amount: Number(r.amount_delta || 0),
        affectsBalance: true,
        by: r.created_by_name ?? "-",
      });
    }

    // Expense
    for (const r of expResp) {
      if (fCat && fCat !== "Expense") continue;
      result.push({
        bankId: r.bank_id,
        tsClick: r.created_at,
        tsPickTop: r.txn_at_final,
        cat: "Expense",
        bankTop: labelBank(r.bank_id),
        bankSub: r.description ?? "",
        desc: r.description ?? "-",
        amount: Number(r.amount || 0), // biasanya sudah negatif
        affectsBalance: true,
        by: r.created_by_name ?? "-",
      });
    }

    // filter "Search desc"
    const filtered = fDesc.trim()
      ? result.filter((r) => {
          const hay = (r.desc ?? "") + " " + (r.bankSub ?? "") + " " + (r.bankTop ?? "");
          return hay.toLowerCase().includes(fDesc.trim().toLowerCase());
        })
      : result;

    // sort: terbaru paling atas - pakai tsClick (desc). Sort stabil â†’ urutan TT tetap TO â†’ FEE â†’ FROM
    filtered.sort((a, b) => (a.tsClick > b.tsClick ? -1 : a.tsClick < b.tsClick ? 1 : 0));

    /* ============================================================
       HITUNG START/FINISH (running mundur per bank & per timestamp)
       ------------------------------------------------------------
       - currentBalance[bank] = saldo SEKARANG (sesudah semua transaksi)
       - untuk tiap grup (bankId, tsClick) dari atas ke bawah:
         * sumDelta = Î£ amount (baris yang memengaruhi saldo)
         * balanceBeforeGroup = currentBalance - sumDelta
         * urutkan intra-grup (WDâ†’Fee WD, FROM TTâ†’Fee TT, lain single)
         * jalankan di dalam grup dari balanceBeforeGroup
         * setelah grup selesai: currentBalance = balanceBeforeGroup
       - baris nonâ€‘pengaruh (Pending DP) tetap pakai snapshot DB.
       ============================================================ */

    // 1) Ambil saldo sekarang per bank
    type BankBalance = { id: number; balance: number | null };
    const { data: banksNow } = await supabase
      .from("banks")
      .select("id, balance") as unknown as { data: BankBalance[] | null };
    const live = new Map<number, number | null>();
    (banksNow ?? []).forEach(b => live.set(b.id, b.balance ?? null));

    // 2) Grouping per (bankId|tsClick) hanya utk baris yang memengaruhi saldo
    const groupOrder: string[] = [];
    const groupMap = new Map<string, number[]>();
    filtered.forEach((r, idx) => {
      if (!r.affectsBalance) return; // skip Pending DP dari running
      const key = `${r.bankId}|${r.tsClick}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
        groupOrder.push(key);
      }
      groupMap.get(key)!.push(idx);
    });

    // 3) Fungsi urutan intra-grup (peristiwa historis)
    const orderInGroup = (row: Row) => {
      const isWDFee = row.cat === "Biaya Transfer" && (row.bankSub ?? "").startsWith("WD dari");
      const isTTFee = row.cat === "Biaya Transfer" && (row.bankSub ?? "").startsWith("Transfer dari");
      const isWD    = row.cat === "WD";
      const isTTFrom= row.cat === "Sesama CM" && row.amount < 0;
      // Urutan: WD (1) â†’ Fee WD (2) ; FROM TT (1) â†’ Fee TT (2) ; lainnya (1)
      if (isWD) return 1;
      if (isWDFee) return 2;
      if (isTTFrom) return 1;
      if (isTTFee) return 2;
      return 1;
    };

    // 4) current balance per bank (saldo sekarang). Jika tak ada di map, asumsikan null.
    const current = new Map<number, number | null>(live);

    // 5) Hasil start/finish
    const computed: { start: number | null; finish: number | null }[] =
      Array(filtered.length).fill(0).map(() => ({ start: null, finish: null }));

    for (const key of groupOrder) {
      const [bankIdStr, ts] = key.split("|");
      const bankId = Number(bankIdStr);
      const idxs = groupMap.get(key)!;

      // saldo SESUDAH grup (karena kita berjalan top-down)
      const afterGroup = current.get(bankId);
      const afterVal: number | null = (afterGroup === undefined ? null : afterGroup);

      // total perubahan dalam grup
      const sumDelta = idxs.reduce((acc, i) => acc + Number(filtered[i].amount || 0), 0);

      // saldo SEBELUM grup = sesudah âˆ’ sumDelta
      const beforeGroup: number | null =
        afterVal === null ? null : Number(afterVal) - Number(sumDelta);

      // urutkan intra-grup (peristiwa historis)
      const ordered = idxs.slice().sort((i1, i2) => {
        const a = orderInGroup(filtered[i1]);
        const b = orderInGroup(filtered[i2]);
        return a - b;
      });

      // jalankan di dalam grup dari saldo sebelum grup
      let state: number | null = beforeGroup;
      for (const idx of ordered) {
        const row = filtered[idx];
        const start = state;
        const finish = start === null ? null : Number(start) + Number(row.amount || 0);
        computed[idx] = { start, finish };
        state = finish;
      }

      // setelah grup selesai, state (finish terakhir) harus = afterVal
      // current untuk bank ini menjadi saldo sebelum grup (untuk grup yang lebih lama di bawahnya)
      current.set(bankId, beforeGroup);
    }

    // 6) Gabungkan hasil (baris nonâ€‘affectsBalance sudah punya start/finish)
    const withBalances: Row[] = filtered.map((r, idx) =>
      r.affectsBalance ? { ...r, start: computed[idx].start, finish: computed[idx].finish } : r
    );

    setRows(withBalances);
    setLoading(false);
    setPage(1); // tampil dari halaman 1 setelah apply
  };

  // jalankan apply setelah daftar bank (label) sudah ter-load
  useEffect(() => {
    if (bankList.length) apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankList]);

  /* =========================
     R E N D E R
     ========================= */

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* FILTERS */}
            <tr className="filters">
              <th className="w-24">
                <button
                  className="border rounded px-2 py-1 text-xs"
                  onClick={() => { setPage(1); apply(); }}
                  title="Cari (apply filter)"
                >
                  Cari
                </button>
              </th>

              {/* Waktu Click */}
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

              {/* Waktu Dipilih */}
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
                  <option value="Biaya Transfer">Biaya Transfer</option>
                  <option value="Adjustment">Adjustment</option>
                  <option value="Expense">Expense</option>
                </select>
              </th>

              {/* Bank */}
              <th className="w-56">
                <select
                  value={fBankId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFBankId(v === "" ? "" : Number(v));
                  }}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="">ALL BANK</option>
                  {bankList.map((b) => (
                    <option key={b.id} value={b.id}>
                      [{b.bank_code}] {b.account_name} - {b.account_no}
                    </option>
                  ))}
                </select>
              </th>

              {/* Search Desc */}
              <th className="w-56">
                <input
                  placeholder="Search desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </th>

              <th colSpan={4} className="text-left">
                <button
                  onClick={() => { setPage(1); apply(); }}
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
                <td colSpan={10}>Loadingâ€¦</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10}>No data</td>
              </tr>
            ) : (
              pageRows.map((r, i) => {
                const dispId = rows.length - (startIdx + i); // ID global: paling baru paling besar
                return (
                  <tr key={`${r.bankId}-${r.tsClick}-${startIdx + i}`} className="align-top">
                    <td>{dispId}</td>
                    <td>{fmtDateJak(r.tsClick)}</td>
                    <td>
                      <div className="whitespace-pre-line">
                        {fmtDateJak(r.tsPickTop)}
                        {r.tsPickBottom ? "\n" + fmtDateJak(r.tsPickBottom) : ""}
                      </div>
                    </td>
                    <td>{r.cat}</td>
                    <td className="whitespace-normal break-words">
                      <div className="font-semibold">{r.bankTop}</div>
                      {r.bankSub && (
                        <>
                          <div className="border-t my-1" />
                          <div>{r.bankSub}</div>
                        </>
                      )}
                    </td>
                    <td className="whitespace-normal break-words">{r.desc ?? "-"}</td>
                    <td>{formatAmount(r.amount)}</td>
                    <td>{r.start == null ? "-" : formatAmount(r.start)}</td>
                    <td>{r.finish == null ? "-" : formatAmount(r.finish)}</td>
                    <td>{r.by ?? "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Kontrol Paginasi (25 baris/halaman) */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-2 p-2 border-t text-sm">
          <div className="opacity-70">
            Menampilkan {rows.length === 0 ? 0 : startIdx + 1}â€“{Math.min(endIdx, rows.length)} dari {rows.length} entri (25/halaman)
          </div>
          <div className="flex items-center gap-1">
            <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(1)} disabled={page <= 1}>
              Â« First
            </button>
            <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              â€¹ Prev
            </button>
            <span className="px-2">
              Halaman <strong>{page}</strong> dari <strong>{totalPages}</strong>
            </span>
            <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next â€º
            </button>
            <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
              Last Â»
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
