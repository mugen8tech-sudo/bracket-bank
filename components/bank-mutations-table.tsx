"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ===== Helpers ===== */
const tzOpt: Intl.DateTimeFormatOptions = { timeZone: "Asia/Jakarta" };
const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", tzOpt) : "—";
const startIsoJakarta = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toISOString();
const endIsoJakarta = (d: string) =>
  new Date(`${d}T23:59:59.999+07:00`).toISOString();

type BankLite = { id: number; bank_code: string; account_name: string; account_no: string };
type ProfileLite = { user_id: string; full_name: string | null };

/** Baris final yang ditampilkan di tabel Bank Mutation */
type BMRow = {
  // untuk penomoran 1..n di layar
  _rowKey: string;                 // unik di client
  clickAt: string;                 // Waktu Click (umum = txn_at_opened, TT = created_at)
  pickedAtList: string[];          // Waktu Dipilih (umum = [txn_at_final], TT = [from_txn_at, to_txn_at])
  cat: "Depo" | "WD" | "Pending DP" | "Sesama CM" | "Adjustment" | "Expense";
  bankId?: number;                 // bank utama baris ini
  bankFromId?: number;             // khusus TT (asal)
  bankToId?: number;               // khusus TT (tujuan)
  amount: number;                  // dampak ke bank (net)
  desc?: string | null;            // kolom Desc (keterangan dari modal)
  by?: string | null;              // user id (akan dipetakan ke full name)
  // untuk keterangan player
  username?: string | null;
  lead_name?: string | null;
  lead_bank_name?: string | null;  // ⬅️ NEW: bank_name player (DP/WD & PDP-assigned route)
};

const PAGE_SIZE = 25;

export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  // data master label
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [byMap, setByMap] = useState<Record<string, string>>({});

  // data utama
  const [rows, setRows] = useState<BMRow[]>([]);
  const [loading, setLoading] = useState(true);

  // filters (Waktu Click saja yang dipakai)
  const [fStart, setFStart] = useState("");
  const [fFinish, setFFinish] = useState("");
  const [fCat, setFCat] = useState<"" | BMRow["cat"]>("");
  const [fBankId, setFBankId] = useState<"" | number>("");
  const [fDesc, setFDesc] = useState("");

  // pagination
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  // label bank lengkap: [CODE] name - no
  const bankLabel = useMemo(() => {
    const map = new Map<number, string>();
    banks.forEach((b) =>
      map.set(b.id, `[${b.bank_code}] ${b.account_name} - ${b.account_no}`)
    );
    return (id?: number) => (id ? map.get(id) ?? `#${id}` : "—");
  }, [banks]);

  /** ====== LOAD ====== */
  const load = async () => {
    setLoading(true);

    // --- bank master untuk label ---
    const { data: bankData } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no")
      .order("id", { ascending: true });

    // ============ tarik data per sumber, filter pakai WAKTU CLICK ============
    const start = fStart ? startIsoJakarta(fStart) : undefined;
    const finish = fFinish ? endIsoJakarta(fFinish) : undefined;

    // Deposits
    const dpSel =
      "id, bank_id, lead_id, amount_net, description, txn_at_final, txn_at_opened, created_by, username_snapshot, lead_name_snapshot";
    let qDP = supabase.from("deposits").select(dpSel);
    if (start) qDP = qDP.gte("txn_at_opened", start);
    if (finish) qDP = qDP.lte("txn_at_opened", finish);
    const { data: dp } = await qDP;

    // Withdrawals
    const wdSel =
      "id, bank_id, lead_id, amount_gross, transfer_fee_amount, description, txn_at_final, txn_at_opened, created_by, username_snapshot, lead_name_snapshot";
    let qWD = supabase.from("withdrawals").select(wdSel);
    if (start) qWD = qWD.gte("txn_at_opened", start);
    if (finish) qWD = qWD.lte("txn_at_opened", finish);
    const { data: wd } = await qWD;

    // Pending Deposits
    const pdpSel =
      "id, bank_id, amount_net, description, txn_at_final, txn_at_opened, created_by, is_assigned, assigned_at, assigned_username_snapshot";
    let qPDP = supabase.from("pending_deposits").select(pdpSel);
    if (start) qPDP = qPDP.gte("txn_at_opened", start);
    if (finish) qPDP = qPDP.lte("txn_at_opened", finish);
    const { data: pdp } = await qPDP;

    // Bank Adjustments
    const adjSel =
      "id, bank_id, amount_delta, description, txn_at_final, txn_at_opened, created_by";
    let qADJ = supabase.from("bank_adjustments").select(adjSel);
    if (start) qADJ = qADJ.gte("txn_at_opened", start);
    if (finish) qADJ = qADJ.lte("txn_at_opened", finish);
    const { data: adj } = await qADJ;

    // Expenses
    const expSel =
      "id, bank_id, amount, category_code, description, txn_at_final, txn_at_opened, created_by";
    let qEXP = supabase.from("bank_expenses").select(expSel);
    if (start) qEXP = qEXP.gte("txn_at_opened", start);
    if (finish) qEXP = qEXP.lte("txn_at_opened", finish);
    const { data: exp } = await qEXP;

    // Interbank Transfers (klik = created_at; dipilih = from & to)
    const ttSel =
      "id, bank_from_id, bank_to_id, amount_gross, fee_amount, from_txn_at, to_txn_at, description, created_at, created_by";
    let qTT = supabase.from("interbank_transfers").select(ttSel);
    if (start) qTT = qTT.gte("created_at", start);
    if (finish) qTT = qTT.lte("created_at", finish);
    const { data: tt } = await qTT;

    // ----- build lead bank_name map (for DP/WD + PDP-assign path) -----
    let leadBankById: Record<number, string> = {};
    let bankByUsername: Record<string, string> = {};

    const leadIds: number[] = Array.from(new Set((dp ?? []).map((r: any) => r.lead_id).filter((x: any) => Number.isFinite(x))));
    const userFromPDP: string[] = Array.from(new Set((pdp ?? []).map((r: any) => r.assigned_username_snapshot).filter(Boolean)));

    if (leadIds.length) {
      const { data: leadsById } = await supabase
        .from("leads")
        .select("id, bank_name")
        .in("id", leadIds);
      (leadsById as any[] | null)?.forEach((l) => {
        if (l && typeof l.id === "number") {
          leadBankById[l.id] = l.bank_name ?? "";
        }
      });
    }

    if (userFromPDP.length) {
      const { data: leadsByUser } = await supabase
        .from("leads")
        .select("username, bank_name")
        .in("username", userFromPDP);
      (leadsByUser as any[] | null)?.forEach((l) => {
        if (l && l.username) {
          bankByUsername[l.username] = l.bank_name ?? "";
        }
      });
    }

    // ============ compose ke BMRow ============
    const list: BMRow[] = [];

    (dp ?? []).forEach((r: any) =>
      list.push({
        _rowKey: `dp-${r.id}`,
        clickAt: r.txn_at_opened ?? r.txn_at_final,
        pickedAtList: [r.txn_at_final],
        cat: "Depo",
        bankId: r.bank_id,
        amount: Number(r.amount_net ?? 0),
        desc: r.description ?? null,
        by: r.created_by ?? null,
        username: r.username_snapshot ?? null,
        lead_name: r.lead_name_snapshot ?? null,
        lead_bank_name: (leadBankById[r.lead_id] ?? bankByUsername[r.username_snapshot ?? ""]) || null,
      })
    );

    (wd ?? []).forEach((r: any) =>
      list.push({
        _rowKey: `wd-${r.id}`,
        clickAt: r.txn_at_opened ?? r.txn_at_final,
        pickedAtList: [r.txn_at_final],
        cat: "WD",
        bankId: r.bank_id,
        // Bank keluar uang: amount negatif (biarkan negatif agar terlihat di tabel)
        amount: -Math.abs(Number(r.amount_gross ?? 0)),
        desc: r.description ?? null,
        by: r.created_by ?? null,
        username: r.username_snapshot ?? null,
        lead_name: r.lead_name_snapshot ?? null,
        lead_bank_name: (leadBankById[r.lead_id] ?? bankByUsername[r.username_snapshot ?? ""]) || null,
      })
    );

    (pdp ?? []).forEach((r: any) =>
      list.push({
        _rowKey: `pdp-${r.id}`,
        clickAt: r.txn_at_opened ?? r.txn_at_final,
        pickedAtList: [r.txn_at_final],
        cat: "Pending DP",
        bankId: r.bank_id,
        amount: Number(r.amount_net ?? 0),
        desc: r.description ?? null,
        by: r.created_by ?? null,
        username: r.assigned_username_snapshot ?? null, // jika sudah assign, akan terisi
        lead_name: null,
      })
    );

    // Tambahan rute: DP dari Pending Deposits (assigned) — Waktu Click = assigned_at, Waktu Dipilih = txn_at_final
    (pdp ?? []).forEach((r: any) => {
      if (r.is_assigned && r.assigned_at) {
        list.push({
          _rowKey: `pdp-as-dp-${r.id}`,
          clickAt: r.assigned_at,
          pickedAtList: [r.txn_at_final],
          cat: "Depo",
          bankId: r.bank_id,
          amount: Number(r.amount_net ?? 0),
          desc: r.description ?? null,
          by: r.created_by ?? null,
          username: r.assigned_username_snapshot ?? null,
          lead_name: null,
          lead_bank_name: r.assigned_username_snapshot ? (bankByUsername[r.assigned_username_snapshot] ?? null) : null,
        });
      }
    });

    (adj ?? []).forEach((r: any) =>
      list.push({
        _rowKey: `adj-${r.id}`,
        clickAt: r.txn_at_opened ?? r.txn_at_final,
        pickedAtList: [r.txn_at_final],
        cat: "Adjustment",
        bankId: r.bank_id,
        amount: Number(r.amount_delta ?? 0),
        desc: r.description ?? null,
        by: r.created_by ?? null,
      })
    );

    (exp ?? []).forEach((r: any) =>
      list.push({
        _rowKey: `exp-${r.id}`,
        clickAt: r.txn_at_opened ?? r.txn_at_final,
        pickedAtList: [r.txn_at_final],
        cat: "Expense",
        bankId: r.bank_id,
        amount: -Math.abs(Number(r.amount ?? 0)),
        // taruh kategori+deskripsi di kolom Desc, sedangkan keterangan pendek akan kita render di kolom Bank
        desc: r.description ?? r.category_code ?? null,
        by: r.created_by ?? null,
      })
    );

    (tt ?? []).forEach((r: any) => {
      // tampilkan 2 baris: FROM (negatif), TO (positif)
      list.push({
        _rowKey: `ttf-${r.id}`,
        clickAt: r.created_at, // **Waktu Click** TT = created_at
        pickedAtList: [r.from_txn_at, r.to_txn_at], // **Waktu Dipilih** = 2 baris
        cat: "Sesama CM",
        bankId: r.bank_from_id,
        bankFromId: r.bank_from_id,
        bankToId: r.bank_to_id,
        amount: -Math.abs(Number(r.amount_gross ?? 0)),
        desc: r.description ?? null,
        by: r.created_by ?? null,
      });
      list.push({
        _rowKey: `ttt-${r.id}`,
        clickAt: r.created_at,
        pickedAtList: [r.from_txn_at, r.to_txn_at],
        cat: "Sesama CM",
        bankId: r.bank_to_id,
        bankFromId: r.bank_from_id,
        bankToId: r.bank_to_id,
        amount: Math.abs(Number(r.amount_gross ?? 0)),
        desc: r.description ?? null,
        by: r.created_by ?? null,
      });
    });

    // sortir berdasar Waktu Click (terbaru di atas)
    list.sort((a, b) => (a.clickAt < b.clickAt ? 1 : -1));

    // mapping user → fullname
    const uids = Array.from(new Set(list.map((x) => x.by).filter(Boolean))) as string[];
    let who: Record<string, string> = {};
    if (uids.length) {
      const { data: pf } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", uids);
      (pf as ProfileLite[] | null)?.forEach((p) => {
        who[p.user_id] = p.full_name ?? p.user_id.slice(0, 8);
      });
    }

    // simpan
    setBanks((bankData as BankLite[]) ?? []);
    setByMap(who);
    setLoading(false);

    // apply filters (cat/bank/desc) ke list yang sudah compose
    const f = (list as BMRow[]).filter((r) => {
      if (fCat && r.cat !== fCat) return false;
      if (fBankId && r.bankId !== fBankId) return false;
      if (fDesc && !(r.desc || "").toLowerCase().includes(fDesc.toLowerCase())) return false;
      return true;
    });

    setRows(f);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fStart, fFinish, fCat, fBankId, fDesc]);

  /** ===== Render ===== */
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const displayNumber = (idxOnPage: number) =>
    pageRows.length - idxOnPage; // 9..1 di halaman (sesuai contohmu)

  const bankCell = (r: BMRow) => {
    const top = r.bankId ? bankLabel(r.bankId) : "—";
    const sep = <div className="border-t my-1" />;
    // keterangan unik per kategori
    switch (r.cat) {
      case "Depo": {
        const u = r.username || "-";
        const bn = r.lead_bank_name || (r.lead_name ?? null);
        return (
          <div className="whitespace-normal break-words">
            <div className="font-semibold">{top}</div>
            {sep}
            <div>Depo dari {u}{bn ? <> / {bn}</> : null}</div>
          </div>
        );
      }
      case "WD": {
        const u = r.username || "-";
        const bn = r.lead_bank_name || (r.lead_name ?? null);
        return (
          <div className="whitespace-normal break-words">
            <div className="font-semibold">{top}</div>
            {sep}
            <div>WD dari {u}{bn ? <> / {bn}</> : null}</div>
          </div>
        );
      }
      case "Pending DP": {
        const who = r.username || ""; // jika sudah assign akan terisi
        return (
          <div className="whitespace-normal break-words">
            <div className="font-semibold">{top}</div>
            {sep}
            <div>{who ? <>Pending Deposit •</> : "Pending Deposit"}</div>
          </div>
        );
      }
      case "Sesama CM": {
        const from = bankLabel(r.bankFromId);
        const to = bankLabel(r.bankToId);
        return (
          <div className="whitespace-normal break-words">
            <div className="font-semibold">{top}</div>
            {sep}
            <div>
              Transfer dari {from} ke {to}
            </div>
          </div>
        );
      }
      case "Adjustment": {
        return (
          <div className="whitespace-normal break-words">
            <div className="font-semibold">{top}</div>
            {sep}
            <div>{r.desc ?? ""}</div>
          </div>
        );
      }
      case "Expense": {
        return (
          <div className="whitespace-normal break-words">
            <div className="font-semibold">{top}</div>
            {sep}
            <div>Biaya</div>
          </div>
        );
      }
      default:
        return <div className="whitespace-normal break-words">{top}</div>;
    }
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* ===== Filter row (mengunci lebar kolom waktu) ===== */}
            <tr className="filters">
              {/* ID */}
              <th className="w-16">
                <button
                  className="border rounded px-2 py-1 text-xs"
                  title="Urut ulang dari tanggal (terlama→terbaru)"
                  onClick={() => {
                    const sorted = [...rows].sort((a, b) => (a.clickAt < b.clickAt ? -1 : 1));
                    setRows(sorted);
                    setPage(1);
                  }}
                >
                  Sort Oldest
                </button>
              </th>

              {/* Waktu Click (dua input untuk range filter) */}
              <th className="w-[220px]">
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

              {/* Waktu Dipilih (dikunci lebar, tidak ada filter) */}
              <th className="w-[160px]"></th>

              {/* Cat filter */}
              <th className="w-[140px]">
                <select
                  value={fCat}
                  onChange={(e) => setFCat((e.target.value || "") as any)}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="">All</option>
                  <option value="Expense">Expense</option>
                  <option value="WD">WD</option>
                  <option value="Depo">Depo</option>
                  <option value="Pending DP">Pending DP</option>
                  <option value="Sesama CM">Sesama CM</option>
                  <option value="Adjustment">Adjustment</option>
                </select>
              </th>

              {/* Bank filter */}
              <th className="w-[260px]">
                <select
                  value={fBankId as any}
                  onChange={(e) => setFBankId(e.target.value ? Number(e.target.value) : "")}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="">ALL BANK</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      [{b.bank_code}] {b.account_name} - {b.account_no}
                    </option>
                  ))}
                </select>
              </th>

              {/* Desc search */}
              <th className="w-[220px]">
                <input
                  placeholder="Search desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </th>

              {/* Amount col spacer */}
              <th className="w-40"></th>

              {/* Start / Finish: dikunci lebarnya */}
              <th className="w-20"></th>
              <th className="w-20"></th>

              {/* Creator + Submit button */}
              <th className="w-32">
                <button
                  onClick={load}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  Submit
                </button>
              </th>
            </tr>

            {/* ===== Header row sesuai urutan yang kamu minta ===== */}
            <tr>
              <th className="text-left w-16">ID</th>
              <th className="text-left w-[220px]">Waktu Click</th>
              <th className="text-left w-[160px]">Waktu Dipilih</th>
              <th className="text-left w-[140px]">Cat</th>
              <th className="text-left w-[260px]">Bank</th>
              <th className="text-left">Desc</th>
              <th className="text-left w-40">Amount</th>
              <th className="text-left w-20">Start</th>
              <th className="text-left w-20">Finish</th>
              <th className="text-left w-32">Creator</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr><td colSpan={10}>Loading…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={10}>No data</td></tr>
            ) : (
              pageRows.map((r, idxOnPage) => {
                const idx = displayNumber(idxOnPage); // 1..n dalam halaman (yang atas = paling besar)
                return (
                  <tr key={r._rowKey} className="align-top">
                    {/* ID (nomor urut dalam halaman) */}
                    <td>{idx}</td>

                    {/* Waktu Click */}
                    <td className="whitespace-normal break-words">
                      {fmtDT(r.clickAt)}
                    </td>

                    {/* Waktu Dipilih (bisa 2 baris untuk TT) */}
                    <td className="whitespace-normal break-words">
                      <div className="space-y-1">
                        {r.pickedAtList.map((t, i) => (
                          <div key={i}>{fmtDT(t)}</div>
                        ))}
                      </div>
                    </td>

                    {/* Cat */}
                    <td>{r.cat}</td>

                    {/* Bank (berisi juga keterangan khusus per kategori) */}
                    <td>{bankCell(r)}</td>

                    {/* Desc */}
                    <td className="whitespace-normal break-words">{r.desc ?? ""}</td>

                    {/* Amount */}
                    <td className="text-left">{formatAmount(r.amount)}</td>

                    {/* Start / Finish: kosong dulu sesuai kesepakatan, nanti diisi running balance */}
                    <td>—</td>
                    <td>—</td>

                    {/* Creator */}
                    <td>{r.by ? byMap[r.by] ?? r.by.slice(0, 8) : "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
