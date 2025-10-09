// components/bank-mutations-table.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ================= Types sumber data ================= */
type BankLite = {
  id: number;
  bank_code: string;
  account_name: string;
  account_no: string;
};
type ProfileLite = { user_id: string; full_name: string | null };

// Deposits
type DP = {
  id: number;
  bank_id: number;
  amount_net: number;
  username_snapshot: string | null;
  description: string | null;
  txn_at_opened: string | null; // bisa null di beberapa DB, fallback created_at
  txn_at_final: string;
  created_at: string;
  created_by: string | null;
};

// Withdrawals
type WD = {
  id: number;
  bank_id: number;
  amount_net: number;
  username_snapshot: string | null;
  description: string | null;
  fee_transfer_amount?: number | null;
  txn_at_opened: string | null;
  txn_at_final: string;
  created_at: string;
  created_by: string | null;
};

// Pending Deposits
type PDP = {
  id: number;
  bank_id: number;
  amount_net: number;
  description: string | null;
  // PDP umumnya tidak menyimpan txn_at_opened → pakai created_at sebagai "click time"
  created_at: string;
  txn_at_final: string;
  created_by: string | null;
};

// Bank Adjustments
type BA = {
  id: number;
  bank_id: number;
  amount_delta: number; // signed
  description: string | null;
  created_at: string; // click time
  txn_at_final: string; // chosen time
  created_by: string | null;
};

// Bank Expenses
type EXP = {
  id: number;
  bank_id: number;
  amount: number; // NEGATIF
  category_code: string | null;
  description: string | null;
  created_at: string; // click time
  txn_at_final: string;
  created_by: string | null;
};

// Interbank Transfers
type TT = {
  id: number;
  bank_from_id: number;
  bank_to_id: number;
  amount_gross: number;
  fee_amount: number;
  description: string | null;
  created_at: string; // click time (satu baris)
  from_txn_at: string; // chosen (from)
  to_txn_at: string; // chosen (to)
  created_by: string | null;
};

/** =============== Baris unified untuk tampilan =============== */
type Row = {
  // idDisplay = nomor urut berdasarkan clickTime ASC (paling lama = 1).
  idDisplay: number;
  clickTime: string; // untuk sorting utama (DESC di tampilan)
  chosenTimeTop?: string; // untuk kolom "Waktu Dipilih" baris 1 (TT-from)
  chosenTimeBottom?: string; // untuk kolom "Waktu Dipilih" baris 2 (TT-to)
  cat: "Depo" | "WD" | "Pending DP" | "Adjustment" | "Expense" | "Sesama CM";
  bankId: number;
  bankTextLines: string[]; // baris yang ditampilkan di kolom Bank (judul + info di bawahnya)
  desc: string;
  amount: number; // signed
  startBalance?: number | null; // sekarang dibiarkan “—”
  finishBalance?: number | null; // sekarang dibiarkan “—”
  creatorId: string | null;
  byName?: string;
};

/** =============== Helpers =============== */
const toJakarta = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const startIsoJakarta = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toISOString();
const endIsoJakarta = (d: string) =>
  new Date(`${d}T23:59:59.999+07:00`).toISOString();

/** =============== Komponen utama =============== */
export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  // data referensi
  const [banks, setBanks] = useState<BankLite[]>([]);
  const bankLabel = useMemo(() => {
    const m: Record<number, string> = {};
    banks.forEach(
      (b) => (m[b.id] = `[${b.bank_code}] ${b.account_name} - ${b.account_no}`)
    );
    return (id: number) => m[id] ?? `#${id}`;
  }, [banks]);

  // data hasil gabungan
  const [allRows, setAllRows] = useState<Row[]>([]);
  const [filtered, setFiltered] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [byMap, setByMap] = useState<Record<string, string>>({});

  // ===== Filters =====
  const [fId, setFId] = useState<string>(""); // cari ID tampil (nomor urut)
  const [fDesc, setFDesc] = useState<string>("");
  const [fCat, setFCat] = useState<string>("ALL");
  const [fBankId, setFBankId] = useState<string>("ALL"); // string “ALL” atau id string
  const [fClickStart, setFClickStart] = useState<string>(""); // yyyy-mm-dd (Jakarta)
  const [fClickFinish, setFClickFinish] = useState<string>("");

  // Ambil bank untuk filter dan label
  const loadBanks = async () => {
    const { data } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no");
    setBanks((data as BankLite[]) ?? []);
  };

  // Ambil & bangun data gabungan
  const loadData = async () => {
    setLoading(true);

    // Batasi range query berdasarkan filter click-time (kalau ada),
    // karna setiap tabel memakai kolom berbeda untuk “click time”.
    const s = fClickStart ? startIsoJakarta(fClickStart) : null;
    const e = fClickFinish ? endIsoJakarta(fClickFinish) : null;

    // === DEPOSITS ===
    {
      let q = supabase.from("deposits").select(
        "id, bank_id, amount_net, username_snapshot, description, txn_at_opened, txn_at_final, created_at, created_by"
      );
      if (s) q = q.gte("txn_at_opened", s);
      if (e) q = q.lte("txn_at_opened", e);
      const { data } = await q;
      const list = (data as DP[] | null) ?? [];
      const rows: Row[] = list.map((r) => ({
        idDisplay: 0, // akan diisi setelah penomoran
        clickTime: r.txn_at_opened || r.created_at,
        chosenTimeTop: r.txn_at_final,
        cat: "Depo",
        bankId: r.bank_id,
        bankTextLines: [
          // judul
          "", // diganti di render (label bank)
          // info
          `Depo dari ${r.username_snapshot ?? "-"}`,
        ],
        desc: r.description ?? "",
        amount: +r.amount_net, // DP menambah saldo
        creatorId: r.created_by,
      }));
      buffer.push(...rows);
    }

    // === WITHDRAWALS ===
    {
      let q = supabase.from("withdrawals").select(
        "id, bank_id, amount_net, username_snapshot, description, txn_at_opened, txn_at_final, created_at, created_by, fee_transfer_amount"
      );
      if (s) q = q.gte("txn_at_opened", s);
      if (e) q = q.lte("txn_at_opened", e);
      const { data } = await q;
      const list = (data as WD[] | null) ?? [];
      const rows: Row[] = list.map((r) => ({
        idDisplay: 0,
        clickTime: r.txn_at_opened || r.created_at,
        chosenTimeTop: r.txn_at_final,
        cat: "WD",
        bankId: r.bank_id,
        bankTextLines: ["", `WD dari ${r.username_snapshot ?? "-"}`],
        desc: r.description ?? "",
        amount: -Math.abs(+r.amount_net), // WD mengurangi saldo
        creatorId: r.created_by,
      }));
      buffer.push(...rows);
    }

    // === PENDING DEPOSITS ===
    {
      let q = supabase
        .from("pending_deposits")
        .select(
          "id, bank_id, amount_net, description, created_at, txn_at_final, created_by"
        );
      if (s) q = q.gte("created_at", s);
      if (e) q = q.lte("created_at", e);
      const { data } = await q;
      const list = (data as PDP[] | null) ?? [];
      const rows: Row[] = list.map((r) => ({
        idDisplay: 0,
        clickTime: r.created_at, // PDP: click time = created_at
        chosenTimeTop: r.txn_at_final,
        cat: "Pending DP",
        bankId: r.bank_id,
        bankTextLines: ["", "Pending Deposit"],
        desc: r.description ?? "",
        amount: +r.amount_net,
        creatorId: r.created_by,
      }));
      buffer.push(...rows);
    }

    // === ADJUSTMENTS ===
    {
      let q = supabase
        .from("bank_adjustments")
        .select(
          "id, bank_id, amount_delta, description, created_at, txn_at_final, created_by"
        );
      if (s) q = q.gte("created_at", s);
      if (e) q = q.lte("created_at", e);
      const { data } = await q;
      const list = (data as BA[] | null) ?? [];
      const rows: Row[] = list.map((r) => ({
        idDisplay: 0,
        clickTime: r.created_at,
        chosenTimeTop: r.txn_at_final,
        cat: "Adjustment",
        bankId: r.bank_id,
        bankTextLines: [""],
        desc: r.description ?? "",
        amount: +r.amount_delta,
        creatorId: r.created_by,
      }));
      buffer.push(...rows);
    }

    // === EXPENSES ===
    {
      let q = supabase
        .from("bank_expenses")
        .select(
          "id, bank_id, amount, category_code, description, created_at, txn_at_final, created_by"
        );
      if (s) q = q.gte("created_at", s);
      if (e) q = q.lte("created_at", e);
      const { data } = await q;
      const list = (data as EXP[] | null) ?? [];
      const rows: Row[] = list.map((r) => ({
        idDisplay: 0,
        clickTime: r.created_at,
        chosenTimeTop: r.txn_at_final,
        cat: "Expense",
        bankId: r.bank_id,
        bankTextLines: [""], // judul bank; detail di kolom Desc
        desc: r.description ?? r.category_code ?? "",
        amount: +r.amount, // sudah negatif dari DB
        creatorId: r.created_by,
      }));
      buffer.push(...rows);
    }

    // === INTERBANK TRANSFERS (2 baris: FROM & TO) ===
    {
      let q = supabase
        .from("interbank_transfers")
        .select(
          "id, bank_from_id, bank_to_id, amount_gross, fee_amount, description, created_at, from_txn_at, to_txn_at, created_by"
        );
      if (s) q = q.gte("created_at", s);
      if (e) q = q.lte("created_at", e);
      const { data } = await q;
      const list = (data as TT[] | null) ?? [];
      const rows: Row[] = list.flatMap((t) => {
        const fromRow: Row = {
          idDisplay: 0,
          clickTime: t.created_at,
          chosenTimeTop: t.from_txn_at,
          chosenTimeBottom: t.to_txn_at,
          cat: "Sesama CM",
          bankId: t.bank_from_id,
          bankTextLines: [
            "",
            `Transfer dari ${bankLabel(t.bank_from_id)} ke ${bankLabel(
              t.bank_to_id
            )}`,
          ],
          desc: t.description ?? "",
          amount: -Math.abs(+t.amount_gross),
          creatorId: t.created_by,
        };
        const toRow: Row = {
          ...fromRow,
          bankId: t.bank_to_id,
          bankTextLines: [
            "",
            `Transfer dari ${bankLabel(t.bank_from_id)} ke ${bankLabel(
              t.bank_to_id
            )}`,
          ],
          amount: +Math.abs(+t.amount_gross),
        };
        return [fromRow, toRow];
      });
      buffer.push(...rows);
    }

    // ====== Penomoran ID (berdasarkan clickTime ASC) ======
    buffer.sort((a, b) => a.clickTime.localeCompare(b.clickTime)); // ASC
    buffer.forEach((r, i) => (r.idDisplay = i + 1));
    // tampilkan default DESC (terbaru di atas)
    buffer.reverse();

    // mapping "by"
    const uids = Array.from(
      new Set(buffer.map((r) => r.creatorId).filter(Boolean) as string[])
    );
    let map: Record<string, string> = {};
    if (uids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", uids);
      (profs as ProfileLite[] | null)?.forEach((p) => {
        map[p.user_id] = p.full_name ?? p.user_id.slice(0, 8);
      });
    }

    setByMap(map);
    setAllRows(buffer);
    setLoading(false);
  };

  // buffer lokal untuk loadData
  const buffer: Row[] = [];

  // pertama kali → muat bank + data
  useEffect(() => {
    (async () => {
      await loadBanks();
      await loadData();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply filters (client-side) ketika klik Submit
  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();

    let rows = [...allRows];

    if (fId.trim()) {
      const wanted = Number(fId.trim());
      if (!Number.isNaN(wanted)) rows = rows.filter((r) => r.idDisplay === wanted);
    }

    if (fDesc.trim()) {
      const q = fDesc.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.desc.toLowerCase().includes(q) ||
          r.bankTextLines.join(" ").toLowerCase().includes(q)
      );
    }

    if (fCat !== "ALL") {
      rows = rows.filter((r) => r.cat === (fCat as Row["cat"]));
    }

    if (fBankId !== "ALL") {
      const bid = Number(fBankId);
      rows = rows.filter((r) => r.bankId === bid);
    }

    // waktu click (client-side guard juga)
    if (fClickStart) {
      const s = startIsoJakarta(fClickStart);
      rows = rows.filter((r) => r.clickTime >= s);
    }
    if (fClickFinish) {
      const e = endIsoJakarta(fClickFinish);
      rows = rows.filter((r) => r.clickTime <= e);
    }

    setFiltered(rows);
  };

  // render source: pakai filter bila ada, kalau tidak pakai allRows
  const rowsToRender = filtered.length || fId || fDesc || fCat !== "ALL" || fBankId !== "ALL" || fClickStart || fClickFinish
    ? filtered
    : allRows;

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1200px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* ===== FILTERS (di atas header) ===== */}
            <tr className="filters">
              {/* ID */}
              <th className="w-20">
                <input
                  placeholder="Cari ID"
                  value={fId}
                  onChange={(e) => setFId(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>

              {/* Waktu Click: from / to (vertikal) → lebih ramping */}
              <th className="w-40">
                <div className="flex flex-col gap-1">
                  <input
                    type="date"
                    value={fClickStart}
                    onChange={(e) => setFClickStart(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Click from"
                  />
                  <input
                    type="date"
                    value={fClickFinish}
                    onChange={(e) => setFClickFinish(e.target.value)}
                    className="border rounded px-2 py-1"
                    aria-label="Click to"
                  />
                </div>
              </th>

              {/* Waktu Dipilih: tidak ada filter */}
              <th className="w-40"></th>

              {/* Cat: lebih sempit */}
              <th className="w-28">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="ALL">ALL</option>
                  <option value="Depo">Depo</option>
                  <option value="WD">WD</option>
                  <option value="Pending DP">Pending DP</option>
                  <option value="Adjustment">Adjustment</option>
                  <option value="Expense">Expense</option>
                  <option value="Sesama CM">Sesama CM</option>
                </select>
              </th>

              {/* ALL BANK: diperlebar */}
              <th className="w-[260px]">
                <select
                  value={fBankId}
                  onChange={(e) => setFBankId(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="ALL">ALL BANK</option>
                  {banks.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      [{b.bank_code}] {b.account_name} - {b.account_no}
                    </option>
                  ))}
                </select>
              </th>

              {/* Search Desc: diperlebar */}
              <th className="w-[280px]">
                <input
                  placeholder="Search desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                />
              </th>

              {/* Amount / Start / Finish: kosong */}
              <th></th>
              <th></th>
              <th></th>

              {/* Creator: tombol Submit diletakkan di sini */}
              <th className="whitespace-nowrap w-28">
                <button
                  onClick={applyFilters}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  Submit
                </button>
              </th>
            </tr>

            {/* ===== HEADER ===== */}
            <tr>
              <th className="text-left w-20">ID</th>
              <th className="text-left w-48">Waktu Click</th>
              <th className="text-left w-48">Waktu Dipilih</th>
              <th className="text-left w-28">Cat</th>
              <th className="text-left min-w-[280px]">Bank</th>
              <th className="text-left min-w-[260px]">Desc</th>
              <th className="text-left w-40">Amount</th>
              <th className="text-left w-28">Start</th>
              <th className="text-left w-28">Finish</th>
              <th className="text-left w-32">Creator</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10}>Loading…</td>
              </tr>
            ) : rowsToRender.length === 0 ? (
              <tr>
                <td colSpan={10}>No data</td>
              </tr>
            ) : (
              rowsToRender.map((r) => (
                <tr key={`${r.cat}-${r.bankId}-${r.clickTime}-${r.amount}-${r.idDisplay}`} className="align-top">
                  {/* ID (nomor urut berdasarkan clickTime ASC) */}
                  <td>{r.idDisplay}</td>

                  {/* Waktu Click */}
                  <td>{toJakarta(r.clickTime)}</td>

                  {/* Waktu Dipilih (TT: dua baris) */}
                  <td>
                    {r.chosenTimeTop ? toJakarta(r.chosenTimeTop) : "—"}
                    {r.chosenTimeBottom ? (
                      <>
                        <br />
                        {toJakarta(r.chosenTimeBottom)}
                      </>
                    ) : null}
                  </td>

                  {/* Cat */}
                  <td>{r.cat}</td>

                  {/* Bank text (judul bank + keterangan unik) */}
                  <td className="whitespace-normal break-words">
                    <div className="font-medium">{bankLabel(r.bankId)}</div>
                    <div className="border-t my-1"></div>
                    {r.bankTextLines
                      .filter(Boolean)
                      .map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                  </td>

                  {/* Desc */}
                  <td className="whitespace-normal break-words">{r.desc || "—"}</td>

                  {/* Amount */}
                  <td>{formatAmount(r.amount)}</td>

                  {/* Start / Finish: belum dihitung → tampil “—” */}
                  <td>—</td>
                  <td>—</td>

                  {/* Creator */}
                  <td>{r.creatorId ? byMap[r.creatorId] ?? r.creatorId.slice(0, 8) : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
