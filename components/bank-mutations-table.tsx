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
  username_snapshot: string | null;
  lead_name_snapshot: string | null;
  lead_bank_snapshot: string | null;
  lead_accno_snapshot: string | null;
  txn_at_opened: string; // Waktu Click
  txn_at_final: string;  // Waktu Dipilih
  created_by: string | null;
  // kolom baru untuk running balance (boleh null di data lama)
  balance_before?: number | null;
  balance_after?: number | null;
};

type WithdrawalRow = {
  id: number;
  bank_id: number;
  amount_gross: number;
  username_snapshot: string | null;
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
  // assign PDP → masuk sebagai Depo
  assigned_at: string | null;              // Waktu Click (untuk rute assign)
  txn_at_final: string;                    // Waktu Dipilih (untuk rute assign)
  assigned_username_snapshot: string | null;
  created_by: string | null;               // creator PDP
  // kolom baru:
  balance_before?: number | null;
  balance_after?: number | null;
};

type AdjustmentRow = {
  id: number;
  bank_id: number;
  amount: number;
  description: string | null;
  txn_at_opened: string;
  txn_at_final: string;
  created_by: string | null;
  // kolom baru:
  balance_before?: number | null;
  balance_after?: number | null;
};

type ExpenseRow = {
  id: number;
  bank_id: number;
  amount: number; // selalu negatif
  category_code: string | null;
  description: string | null;
  created_at: string;  // dipakai Tgl (sesuai instruksi)
  txn_at_final: string; // dipertahankan jika perlu
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
  created_at: string;   // Waktu Click (satu baris)
  from_txn_at: string;  // Waktu Dipilih (atas)
  to_txn_at: string;    // Waktu Dipilih (bawah)
  description: string | null;
  created_by: string | null;
  // kolom baru:
  balance_before_from?: number | null;
  balance_after_from?: number | null;
  balance_before_to?: number | null;
  balance_after_to?: number | null;
};

/* =========================
   H E L P E R S
   ========================= */

// YYYY-MM-DD -> ISO (Asia/Jakarta start/end)
const startIsoJakarta = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toISOString();
const endIsoJakarta = (d: string) =>
  new Date(`${d}T23:59:59.999+07:00`).toISOString();

// Render tanggal lokal (Asia/Jakarta)
function fmtDateJak(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  } catch {
    return iso ?? "";
  }
}

const PAGE_SIZE = 100;

/* =========================
   C O M P O N E N T
   ========================= */

export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  const [loading, setLoading] = useState(true);

  // data
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [byMap, setByMap] = useState<Record<string, string>>({});

  // result after join
  type Row = {
    id: string | number;
    cat:
      | "Depo"
      | "WD"
      | "Pending DP"
      | "Adjustment"
      | "Expense"
      | "Sesama CM";
    // waktu
    tsClickTop?: string | null;     // baris atas kolom Waktu Click (TT hanya 1 baris: created_at)
    tsClickBottom?: string | null;  // baris bawah kolom Waktu Click (umumnya kosong)
    tsPickTop?: string | null;      // baris atas kolom Waktu Dipilih (TT: from)
    tsPickBottom?: string | null;   // baris bawah kolom Waktu Dipilih (TT: to)
    // bank
    bank_id: number;
    bankLabel: string;
    bankDesc: string; // teks di bawah garis pemisah (unik per kategori)
    // amount & balance
    amount: number;
    start?: number | null;
    finish?: number | null;
    // who
    byName: string;
  };

  const [rows, setRows] = useState<Row[]>([]);

  // filter & paging
  const [fStart, setFStart] = useState<string>("");
  const [fFinish, setFFinish] = useState<string>("");
  const [fCat, setFCat] = useState<
    "" | "Depo" | "WD" | "Pending DP" | "Adjustment" | "Expense" | "Sesama CM"
  >("");
  const [fBankId, setFBankId] = useState<number | "ALL">("ALL");

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // label bank
  const bankLabel = useMemo(() => {
    const map: Record<number, string> = {};
    for (const b of banks) {
      map[b.id] = `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
    }
    return (id: number) => map[id] ?? `#${id}`;
  }, [banks]);

  /* ===== LOAD ===== */
  const load = async (pageToLoad = page) => {
    setLoading(true);

    // banks
    const { data: bankData } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no");
    setBanks((bankData as BankLite[]) ?? []);

    // build filters
    const hasStart = !!fStart;
    const hasFinish = !!fFinish;
    const sISO = hasStart ? startIsoJakarta(fStart) : null;
    const eISO = hasFinish ? endIsoJakarta(fFinish) : null;
    const bankIdFilter = fBankId === "ALL" ? null : (fBankId as number);

    // fetch data paralel
    const [deposits, withdrawals, pendings, adjustments, expenses, tts] =
      await Promise.all([
        // ===== Deposits (mutasi Depo)
        (async () => {
          let q = supabase
            .from("deposits")
            .select(
              "id, bank_id, amount_net, username_snapshot, lead_name_snapshot, lead_bank_snapshot, lead_accno_snapshot, txn_at_opened, txn_at_final, created_by, balance_before, balance_after"
            );
          if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
          if (hasStart) q = q.gte("txn_at_opened", sISO!);
          if (hasFinish) q = q.lte("txn_at_opened", eISO!);
          const { data, error } = await q;
          if (error) {
            console.error(error);
            return [] as DepositRow[];
          }
          return (data as DepositRow[]) ?? [];
        })(),
        // ===== Withdrawals (mutasi WD)
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
          if (error) {
            console.error(error);
            return [] as WithdrawalRow[];
          }
          return (data as WithdrawalRow[]) ?? [];
        })(),
        // ===== Pending Deposits (mutasi Pending DP + rute Assign → Depo)
        (async () => {
          let q = supabase
            .from("pending_deposits")
            .select(
              "id, bank_id, amount_net, description, assigned_at, txn_at_final, assigned_username_snapshot, created_by, balance_before, balance_after"
            );
          if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
          if (hasStart) q = q.gte("txn_at_final", sISO!);
          if (hasFinish) q = q.lte("txn_at_final", eISO!);
          const { data, error } = await q;
          if (error) {
            console.error(error);
            return [] as PendingDepositRow[];
          }
          return (data as PendingDepositRow[]) ?? [];
        })(),
        // ===== Adjustments
        (async () => {
          let q = supabase
            .from("bank_adjustments")
            .select(
              "id, bank_id, amount, description, txn_at_opened, txn_at_final, created_by, balance_before, balance_after"
            );
          if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
          if (hasStart) q = q.gte("txn_at_opened", sISO!);
          if (hasFinish) q = q.lte("txn_at_opened", eISO!);
          const { data, error } = await q;
          if (error) {
            console.error(error);
            return [] as AdjustmentRow[];
          }
          return (data as AdjustmentRow[]) ?? [];
        })(),
        // ===== Expenses (Biaya)
        (async () => {
          let q = supabase
            .from("bank_expenses")
            .select(
              "id, bank_id, amount, category_code, description, created_at, txn_at_final, created_by, balance_before, balance_after"
            )
            .order("created_at", { ascending: false }); // mengikuti halaman expenses
          if (bankIdFilter) q = q.eq("bank_id", bankIdFilter);
          if (hasStart) q = q.gte("created_at", sISO!);
          if (hasFinish) q = q.lte("created_at", eISO!);
          const { data, error } = await q;
          if (error) {
            console.error(error);
            return [] as ExpenseRow[];
          }
          return (data as ExpenseRow[]) ?? [];
        })(),
        // ===== Interbank Transfers (Sesama CM)
        (async () => {
          let q = supabase
            .from("interbank_transfers")
            .select(
              "id, bank_from_id, bank_to_id, amount_gross, fee_amount, created_at, from_txn_at, to_txn_at, description, created_by, balance_before_from, balance_after_from, balance_before_to, balance_after_to"
            )
            .order("created_at", { ascending: false });
          if (bankIdFilter) q = q.or(
            `bank_from_id.eq.${bankIdFilter},bank_to_id.eq.${bankIdFilter}`
          );
          if (hasStart) q = q.gte("created_at", sISO!);
          if (hasFinish) q = q.lte("created_at", eISO!);
          const { data, error } = await q;
          if (error) {
            console.error(error);
            return [] as TT[];
          }
          return (data as TT[]) ?? [];
        })(),
      ]);

    // map who
    const uids = new Set<string>();
    for (const d of deposits) if (d.created_by) uids.add(d.created_by);
    for (const d of withdrawals) if (d.created_by) uids.add(d.created_by);
    for (const d of pendings) if (d.created_by) uids.add(d.created_by);
    for (const d of adjustments) if (d.created_by) uids.add(d.created_by);
    for (const d of expenses) if (d.created_by) uids.add(d.created_by);
    for (const d of tts) if (d.created_by) uids.add(d.created_by);

    let who: Record<string, string> = {};
    if (uids.size) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", Array.from(uids));
      (profs as ProfileLite[] | null)?.forEach((p) => {
        who[p.user_id] = p.full_name ?? p.user_id.slice(0, 8);
      });
    }
    setByMap(who);

    const bankStr = (id: number) => bankLabel(id);

    const out: Row[] = [];

    // ==== Depo ====
    for (const r of deposits) {
      // GUARD: abaikan DP yang berasal dari assign PDP TANPA snapshot bank player
      if (!r.lead_bank_snapshot || !r.lead_accno_snapshot) continue;

      out.push({
        id: `DP-${r.id}`,
        cat: "Depo",
        tsClickTop: r.txn_at_opened,
        tsPickTop: r.txn_at_final,
        bank_id: r.bank_id,
        bankLabel: bankStr(r.bank_id),
        bankDesc: `Depo dari ${r.username_snapshot ?? "-"} / ${
          r.lead_name_snapshot ?? "-"
        }`,
        amount: Number(r.amount_net || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        byName: r.created_by ? who[r.created_by] ?? r.created_by : "-",
      });
    }

    // ==== WD ====
    for (const r of withdrawals) {
      out.push({
        id: `WD-${r.id}`,
        cat: "WD",
        tsClickTop: r.txn_at_opened,
        tsPickTop: r.txn_at_final,
        bank_id: r.bank_id,
        bankLabel: bankStr(r.bank_id),
        bankDesc: `WD dari ${r.username_snapshot ?? "-"}`,
        amount: -Math.abs(Number(r.amount_gross || 0)),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        byName: r.created_by ? who[r.created_by] ?? r.created_by : "-",
      });
    }

    // ==== Pending Deposit (tetap ditampilkan, termasuk yg sudah assign) ====
    for (const r of pendings) {
      // Rute assign PDP → ikut Depo (sesuai instruksi)
      if (r.assigned_at && r.assigned_username_snapshot) {
        out.push({
          id: `DP-${r.id}`, // tetap diberi prefix DP (assign PDP → Depo)
          cat: "Depo",
          tsClickTop: r.assigned_at,
          tsPickTop: r.txn_at_final,
          bank_id: r.bank_id,
          bankLabel: bankStr(r.bank_id),
          bankDesc: `Depo dari ${r.assigned_username_snapshot} / -`,
          amount: Number(r.amount_net || 0),
          start: r.balance_before ?? null,
          finish: r.balance_after ?? null,
          byName: r.created_by ? who[r.created_by] ?? r.created_by : "-",
        });
      }

      // Tetap catat mutasi Pending DP-nya sendiri (tidak dihapus)
      out.push({
        id: `PDP-${r.id}`,
        cat: "Pending DP",
        tsClickTop: r.txn_at_final, // PDP: pakai txn_at_final sebagai Waktu Click
        tsPickTop: "", // kosong
        bank_id: r.bank_id,
        bankLabel: bankStr(r.bank_id),
        bankDesc: "Pending Deposit",
        amount: Number(r.amount_net || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        byName: r.created_by ? who[r.created_by] ?? r.created_by : "-",
      });
    }

    // ==== Adjustment ====
    for (const r of adjustments) {
      out.push({
        id: `ADJ-${r.id}`,
        cat: "Adjustment",
        tsClickTop: r.txn_at_opened,
        tsPickTop: r.txn_at_final,
        bank_id: r.bank_id,
        bankLabel: bankStr(r.bank_id),
        bankDesc: r.description ?? "",
        amount: Number(r.amount || 0),
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        byName: r.created_by ? who[r.created_by] ?? r.created_by : "-",
      });
    }

    // ==== Expense ====
    for (const r of expenses) {
      out.push({
        id: `EXP-${r.id}`,
        cat: "Expense",
        tsClickTop: r.created_at, // Tgl di Expenses pakai created_at
        tsPickTop: r.txn_at_final || null,
        bank_id: r.bank_id,
        bankLabel: bankStr(r.bank_id),
        bankDesc: r.description ?? "",
        amount: Number(r.amount || 0), // selalu negatif di table ini
        start: r.balance_before ?? null,
        finish: r.balance_after ?? null,
        byName: r.created_by ? who[r.created_by] ?? r.created_by : "-",
      });
    }

    // ==== Sesama CM (TT) ====
    for (const r of tts) {
      // FROM
      if (!bankIdFilter || bankIdFilter === r.bank_from_id) {
        out.push({
          id: `TT-${r.id}-FROM`,
          cat: "Sesama CM",
          tsClickTop: r.created_at,
          tsPickTop: r.from_txn_at,
          tsPickBottom: r.to_txn_at,
          bank_id: r.bank_from_id,
          bankLabel: bankStr(r.bank_from_id),
          bankDesc: `Transfer dari ${bankStr(r.bank_from_id)} ke ${bankStr(
            r.bank_to_id
          )}`,
          amount: -Math.abs(Number(r.amount_gross || 0)),
          start: r.balance_before_from ?? null,
          finish: r.balance_after_from ?? null,
          byName: r.created_by ? who[r.created_by] ?? r.created_by : "-",
        });
      }
      // TO
      if (!bankIdFilter || bankIdFilter === r.bank_to_id) {
        out.push({
          id: `TT-${r.id}-TO`,
          cat: "Sesama CM",
          tsClickTop: r.created_at,
          tsPickTop: r.from_txn_at,
          tsPickBottom: r.to_txn_at,
          bank_id: r.bank_to_id,
          bankLabel: bankStr(r.bank_to_id),
          bankDesc: `Transfer dari ${bankStr(r.bank_from_id)} ke ${bankStr(
            r.bank_to_id
          )}`,
          amount: Number(r.amount_gross || 0),
          start: r.balance_before_to ?? null,
          finish: r.balance_after_to ?? null,
          byName: r.created_by ? who[r.created_by] ?? r.created_by : "-",
        });
      }
    }

    // urut berdasarkan Waktu Click (top) ascending untuk ID 1..n,
    // tapi ditampilkan descending (terbaru di atas)
    const sortedAsc = out
      .map((r) => ({
        ...r,
        sortTs: r.tsClickTop
          ? new Date(r.tsClickTop).getTime()
          : 0,
      }))
      .sort((a, b) => a.sortTs - b.sortTs);

    // assign ID urut (1..n), lalu tampilkan DESC
    const numbered = sortedAsc.map((r, idx) => ({ ...r, seq: idx + 1 }));
    const desc = numbered.sort((a, b) => b.seq - a.seq);

    setRows(desc);
    setTotal(desc.length);
    setPage(1);
    setLoading(false);
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1);
  };

  // paging helpers
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const goFirst = () => canPrev && setPage(1);
  const goPrev = () => canPrev && setPage((p) => Math.max(1, p - 1));
  const goNext = () => canNext && setPage((p) => Math.min(totalPages, p + 1));
  const goLast = () => canNext && setPage(totalPages);

  // options banks
  const bankOptions = useMemo(
    () =>
      banks.map((b) => ({
        id: b.id,
        label: `[${b.bank_code}] ${b.account_name} - ${b.account_no}`,
      })),
    [banks]
  );

  /* =========================
     R E N D E R
     ========================= */
  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table
          className="table-grid min-w-[1100px]"
          style={{ borderCollapse: "collapse" }}
        >
          <thead>
            {/* ===== FILTERS (layout seperti contoh) ===== */}
            <tr className="filters">
              {/* ID search */}
              <th className="w-20">
                <input
                  placeholder="Cari ID"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyFilters();
                  }}
                  className="w-full border rounded px-2 py-1"
                  aria-label="Cari ID"
                />
              </th>

              {/* Waktu Click (atas/bawah) */}
              <th>
                <div className="flex flex-col gap-1">
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
                </div>
              </th>

              {/* Waktu Dipilih: tidak ada filter */}
              <th></th>

              {/* Cat */}
              <th className="w-36">
                <select
                  value={fCat}
                  onChange={(e) =>
                    setFCat(e.target.value as typeof fCat)
                  }
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="">ALL</option>
                  <option value="Depo">Depo</option>
                  <option value="WD">WD</option>
                  <option value="Pending DP">Pending DP</option>
                  <option value="Adjustment">Adjustment</option>
                  <option value="Expense">Expense</option>
                  <option value="Sesama CM">Sesama CM</option>
                </select>
              </th>

              {/* Bank */}
              <th className="w-64">
                <select
                  value={fBankId === "ALL" ? "" : String(fBankId)}
                  onChange={(e) =>
                    setFBankId(e.target.value ? Number(e.target.value) : "ALL")
                  }
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

              {/* Desc search */}
              <th>
                <input
                  placeholder="Search desc"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyFilters();
                  }}
                  className="w-full border rounded px-2 py-1"
                />
              </th>

              {/* Amount + Start + Finish + Creator: kosong */}
              <th></th>
              <th>
                <button
                  onClick={applyFilters}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  Submit
                </button>
              </th>
              <th></th>
            </tr>

            {/* ===== HEADER (urutan final) ===== */}
            <tr>
              <th className="text-left w-20">ID</th>
              <th className="text-left w-56">Waktu Click</th>
              <th className="text-left w-56">Waktu Dipilih</th>
              <th className="text-left w-36">Cat</th>
              <th className="text-left w-[260px]">Bank</th>
              <th className="text-left">Desc</th>
              <th className="text-left w-36">Amount</th>
              <th className="text-left w-40">Start</th>
              <th className="text-left w-40">Finish</th>
              <th className="text-left w-40">Creator</th>
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
              rows.map((r) => {
                // filter in-memory setelah join
                if (fCat && r.cat !== fCat) return null;
                if (fBankId !== "ALL" && r.bank_id !== fBankId) return null;

                return (
                  <tr key={String(r.id)} className="align-top hover:bg-gray-50">
                    <td>{String(r.id).replace(/^(DP|WD|PDP|ADJ|EXP|TT)-/,"")}</td>

                    {/* Waktu Click */}
                    <td className="whitespace-pre">
                      <div>{fmtDateJak(r.tsClickTop)}</div>
                      <div className="text-gray-500 text-xs">
                        {r.tsClickBottom ? fmtDateJak(r.tsClickBottom) : ""}
                      </div>
                    </td>

                    {/* Waktu Dipilih */}
                    <td className="whitespace-pre">
                      <div>{fmtDateJak(r.tsPickTop)}</div>
                      <div className="text-gray-500 text-xs">
                        {r.tsPickBottom ? fmtDateJak(r.tsPickBottom) : ""}
                      </div>
                    </td>

                    <td>{r.cat}</td>

                    {/* Bank + garis pemisah + desc unik */}
                    <td className="whitespace-normal break-words">
                      <div className="font-semibold">{r.bankLabel}</div>
                      <div className="border-t my-1"></div>
                      <div className="text-sm">{r.bankDesc}</div>
                    </td>

                    <td className="whitespace-normal break-words">
                      {/* kolom Desc terpisah (untuk Expense/Adjustment dsb) */}
                      {/* (Saat ini sebagian kategori sudah masukkan desc unik di kolom Bank) */}
                    </td>

                    <td>{formatAmount(r.amount)}</td>

                    {/* Start / Finish (pakai balance_before/after kalau ada) */}
                    <td>{r.start != null ? formatAmount(r.start) : "—"}</td>
                    <td>{r.finish != null ? formatAmount(r.finish) : "—"}</td>

                    <td>{r.byName}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
