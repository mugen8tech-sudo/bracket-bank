"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";

/** ===== Types minimal per sumber data ===== */
type BankLite = { id: number; bank_code: string; account_name: string; account_no: string };
type ProfileLite = { user_id: string; full_name: string | null };
type LeadLite = { id: number; username: string | null; bank_name: string | null };

type DepoRow = {
  id: number;
  bank_id: number;
  lead_id: number | null;
  username_snapshot: string | null;
  amount_net: number;
  txn_at_opened: string;   // waktu click
  txn_at_final: string;    // waktu dipilih
  created_by: string | null;
};

type WdRow = {
  id: number;
  bank_id: number;
  lead_id: number | null;
  username_snapshot: string | null;
  amount_net: number;      // negatif
  txn_at_opened: string;
  txn_at_final: string;
  created_by: string | null;
};

type PdpRow = {
  id: number;
  bank_id: number;
  amount_net: number;
  txn_at_opened: string;
  txn_at_final: string;
  is_assigned: boolean;
  assigned_username_snapshot: string | null;
  assigned_at: string | null; // boleh null kalau belum ada di DB
  created_by: string | null;
};

type TtRow = {
  id: number;
  bank_from_id: number;
  bank_to_id: number;
  amount_gross: number;    // net transfer (fee dipisah di mutasi biaya transaksi)
  fee_amount: number;
  from_txn_at: string;
  to_txn_at: string;
  created_at: string;      // dipakai sebagai “Waktu Click”
  created_by: string | null;
};

type AdjRow = {
  id: number;
  bank_id: number;
  amount_delta: number;
  txn_at_final: string;
  created_by: string | null;
  description: string | null;
};
type ExpRow = {
  id: number;
  bank_id: number;
  amount: number;            // negatif
  category_code: string | null;
  txn_at_final: string;
  created_by: string | null;
  description: string | null;
};

/** ===== Row gabungan utk render ===== */
type MutRow = {
  // tampilan
  seq: number;                 // nomor urut yang ditampilkan (paling atas terbesar)
  clickAt: string;             // Waktu Click (txn_at_opened / created_at untuk TT)
  finalAt: string | string[];  // Waktu Dipilih (TT: array [from,to])
  cat: string;                 // “Depo”, “WD”, “Pending DP”, “Sesama CM”, “Adjustment”, “Expense”
  bankIdForLabel?: number;     // baris label bank utama
  bankCell: React.ReactNode;   // isi kolom Bank (sudah di‑format)
  desc: string;                // isi kolom Desc
  amount: number;
  start?: number | null;       // belum dihitung (placeholder)
  finish?: number | null;      // belum dihitung (placeholder)
  creator: string;
  // untuk filter
  bankIdsForFilter: number[];  // TT memuat 2 bank id
  plainDescForSearch: string;
};

/** ===== Helpers tanggal (Asia/Jakarta → ISO) ===== */
const startIsoJakarta = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toISOString();
const endIsoJakarta = (d: string) =>
  new Date(`${d}T23:59:59.999+07:00`).toISOString();

export default function BankMutationsTable() {
  const supabase = supabaseBrowser();

  /** ====== state data ====== */
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [byMap, setByMap] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<MutRow[]>([]);
  const [loading, setLoading] = useState(true);

  /** ====== filter & paging ====== */
  const [fClickStart, setFClickStart] = useState<string>("");
  const [fClickFinish, setFClickFinish] = useState<string>("");
  const [fCat, setFCat] = useState<string>("ALL");
  const [fBankId, setFBankId] = useState<string>("ALL"); // string agar mudah menyetel "ALL"
  const [fDesc, setFDesc] = useState<string>("");

  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** ====== label helper bank ====== */
  const bankLabel = useMemo(() => {
    const map: Record<number, string> = {};
    for (const b of banks) {
      map[b.id] = `[${b.bank_code}] ${b.account_name} - ${b.account_no}`;
    }
    return (id: number) => map[id] ?? `#${id}`;
  }, [banks]);

  /** ====== load utama (gabungkan semua sumber) ====== */
  const load = async (pageToLoad = page) => {
    setLoading(true);

    // Ambil master bank (untuk label & filter)
    const { data: bankData } = await supabase
      .from("banks")
      .select("id, bank_code, account_name, account_no")
      .order("account_name", { ascending: true });

    // Siapkan rentang filter clickAt
    const clickFromISO = fClickStart ? startIsoJakarta(fClickStart) : null;
    const clickToISO = fClickFinish ? endIsoJakarta(fClickFinish) : null;

    // ====== Query paralel per tabel (hanya kolom yang dibutuhkan) ======
    // filter tanggal dilakukan pada kolom “clickAt”:
    //  - DP/WD/PDP  : txn_at_opened
    //  - TT         : created_at
    //  - Adj/Exp    : txn_at_final (boleh dianggap sama dengan clickAt untuk listing)
    const [
      dpResp,
      wdResp,
      pdpResp,
      ttResp,
      adjResp,
      expResp,
    ] = await Promise.all([
      supabase
        .from("deposits")
        .select(
          "id, bank_id, lead_id, username_snapshot, amount_net, txn_at_opened, txn_at_final, created_by"
        )
        .gte("txn_at_opened", clickFromISO ?? "-infinity")
        .lte("txn_at_opened", clickToISO ?? "infinity"),
      supabase
        .from("withdrawals")
        .select(
          "id, bank_id, lead_id, username_snapshot, amount_net, txn_at_opened, txn_at_final, created_by"
        )
        .gte("txn_at_opened", clickFromISO ?? "-infinity")
        .lte("txn_at_opened", clickToISO ?? "infinity"),
      supabase
        .from("pending_deposits")
        .select(
          "id, bank_id, amount_net, txn_at_opened, txn_at_final, is_assigned, assigned_username_snapshot, assigned_at, created_by"
        )
        .gte("txn_at_opened", clickFromISO ?? "-infinity")
        .lte("txn_at_opened", clickToISO ?? "infinity"),
      supabase
        .from("interbank_transfers")
        .select(
          "id, bank_from_id, bank_to_id, amount_gross, fee_amount, from_txn_at, to_txn_at, created_at, created_by"
        )
        .gte("created_at", clickFromISO ?? "-infinity")
        .lte("created_at", clickToISO ?? "infinity"),
      supabase
        .from("bank_adjustments")
        .select("id, bank_id, amount_delta, txn_at_final, created_by, description")
        .gte("txn_at_final", clickFromISO ?? "-infinity")
        .lte("txn_at_final", clickToISO ?? "infinity"),
      supabase
        .from("bank_expenses")
        .select("id, bank_id, amount, category_code, txn_at_final, created_by, description")
        .gte("txn_at_final", clickFromISO ?? "-infinity")
        .lte("txn_at_final", clickToISO ?? "infinity"),
    ]);

    const dps = (dpResp.data as DepoRow[] | null) ?? [];
    const wds = (wdResp.data as WdRow[] | null) ?? [];
    const pdps = (pdpResp.data as PdpRow[] | null) ?? [];
    const tts = (ttResp.data as TtRow[] | null) ?? [];
    const adjs = (adjResp.data as AdjRow[] | null) ?? [];
    const exps = (expResp.data as ExpRow[] | null) ?? [];

    // ====== mapping nama user (who created) ======
    const byIds = Array.from(
      new Set(
        [
          ...dps.map((x) => x.created_by),
          ...wds.map((x) => x.created_by),
          ...pdps.map((x) => x.created_by),
          ...tts.map((x) => x.created_by),
          ...adjs.map((x) => x.created_by),
          ...exps.map((x) => x.created_by),
        ].filter(Boolean) as string[]
      )
    );
    let byNameMap: Record<string, string> = {};
    if (byIds.length) {
      const { data: pf } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", byIds);
      (pf as ProfileLite[] | null)?.forEach((p) => {
        byNameMap[p.user_id] = p.full_name ?? p.user_id.slice(0, 8);
      });
    }

    // ====== mapping bank label ======
    const bankMap: Record<number, BankLite> = {};
    (bankData as BankLite[] | null)?.forEach((b) => (bankMap[b.id] = b));

    // ====== mapping player bank_name (PR utama request) ======
    // Depo/Wd: pakai lead_id -> join leads untuk ambil bank_name
    // PDP (assigned -> DP): hanya ada assigned_username_snapshot → cari lead by username
    const leadIds = Array.from(
      new Set(
        [...dps.map((x) => x.lead_id), ...wds.map((x) => x.lead_id)].filter(
          (v): v is number => typeof v === "number"
        )
      )
    );
    const assignedUsernames = Array.from(
      new Set(
        pdps
          .map((x) => x.assigned_username_snapshot)
          .filter(Boolean) as string[]
      )
    );

    const leadId2BankName: Record<number, string> = {};
    const username2BankName: Record<string, string> = {};

    if (leadIds.length) {
      const { data: leadsById } = await supabase
        .from("leads")
        .select("id, bank_name")
        .in("id", leadIds);
      (leadsById as any[] | null)?.forEach((l) => {
        leadId2BankName[l.id] = l.bank_name ?? "";
      });
    }
    if (assignedUsernames.length) {
      const { data: leadsByUser } = await supabase
        .from("leads")
        .select("username, bank_name")
        .in("username", assignedUsernames);
      (leadsByUser as any[] | null)?.forEach((l) => {
        if (l.username) username2BankName[l.username] = l.bank_name ?? "";
      });
    }

    // ====== builder kolom Bank (menerapkan 2 perubahan) ======
    const bankCellLine = (label: string) => (
      <div className="font-medium">{label}</div>
    );
    const sepLine = <div className="border-t my-1" />;

    const cellForDepo = (r: DepoRow) => {
      const label = bankLabel(r.bank_id);
      const uname = r.username_snapshot ?? "-";
      const bname =
        (r.lead_id && leadId2BankName[r.lead_id]) ? leadId2BankName[r.lead_id] : "";
      return (
        <div className="whitespace-normal break-words">
          {bankCellLine(label)}
          {sepLine}
          <div>{`Depo dari ${uname} / ${bname || "-"}`}</div>
        </div>
      );
    };
    const cellForWd = (r: WdRow) => {
      const label = bankLabel(r.bank_id);
      const uname = r.username_snapshot ?? "-";
      const bname =
        (r.lead_id && leadId2BankName[r.lead_id]) ? leadId2BankName[r.lead_id] : "";
      return (
        <div className="whitespace-normal break-words">
          {bankCellLine(label)}
          {sepLine}
          <div>{`WD dari ${uname} / ${bname || "-"}`}</div>
        </div>
      );
    };
    // PDP NOT ASSIGNED → tetap “Pending Deposit”
    const cellForPdp = (r: PdpRow) => {
      const label = bankLabel(r.bank_id);
      return (
        <div className="whitespace-normal break-words">
          {bankCellLine(label)}
          {sepLine}
          <div>Pending Deposit</div>
        </div>
      );
    };
    // PDP ASSIGNED → dianggap route DP (per permintaan) + tampilkan username/bank_name
    const cellForPdpAssignedAsDepo = (r: PdpRow) => {
      const label = bankLabel(r.bank_id);
      const uname = r.assigned_username_snapshot ?? "-";
      const bname = uname ? (username2BankName[uname] ?? "") : "";
      return (
        <div className="whitespace-normal break-words">
          {bankCellLine(label)}
          {sepLine}
          <div>{`Depo dari ${uname} / ${bname || "-"}`}</div>
        </div>
      );
    };
    // TT (Sesama CM) — PERUBAHAN: kolom Bank berisi detail asal → tujuan
    const cellForTt = (r: TtRow) => {
      const fromLabel = bankLabel(r.bank_from_id);
      const toLabel = bankLabel(r.bank_to_id);
      return (
        <div className="whitespace-normal break-words">
          {bankCellLine(fromLabel)}
          {sepLine}
          <div>{`Transfer dari ${fromLabel} ke ${toLabel}`}</div>
        </div>
      );
    };
    const cellForAdj = (r: AdjRow) => {
      const label = bankLabel(r.bank_id);
      return (
        <div className="whitespace-normal break-words">
          {bankCellLine(label)}
          {sepLine}
          <div>{r.description ?? ""}</div>
        </div>
      );
    };
    const cellForExp = (r: ExpRow) => {
      const label = bankLabel(r.bank_id);
      return (
        <div className="whitespace-normal break-words">
          {bankCellLine(label)}
          {sepLine}
          <div>{r.description ?? ""}</div>
        </div>
      );
    };

    // ====== konversi ke MutRow ======
    const tmp: MutRow[] = [];

    // DP
    for (const r of dps) {
      tmp.push({
        seq: 0,
        clickAt: r.txn_at_opened,
        finalAt: r.txn_at_final,
        cat: "Depo",
        bankIdForLabel: r.bank_id,
        bankCell: cellForDepo(r),
        desc: `Depo dari ${r.username_snapshot ?? "-"}`,
        amount: Number(r.amount_net || 0),
        creator: r.created_by ? byNameMap[r.created_by] ?? r.created_by : "-",
        bankIdsForFilter: [r.bank_id],
        plainDescForSearch: `depo ${r.username_snapshot ?? ""}`.toLowerCase(),
      });
    }

    // WD
    for (const r of wds) {
      tmp.push({
        seq: 0,
        clickAt: r.txn_at_opened,
        finalAt: r.txn_at_final,
        cat: "WD",
        bankIdForLabel: r.bank_id,
        bankCell: cellForWd(r),
        desc: `WD dari ${r.username_snapshot ?? "-"}`,
        amount: Number(r.amount_net || 0), // negatif
        creator: r.created_by ? byNameMap[r.created_by] ?? r.created_by : "-",
        bankIdsForFilter: [r.bank_id],
        plainDescForSearch: `wd ${r.username_snapshot ?? ""}`.toLowerCase(),
      });
    }

    // PDP (not assigned)
    for (const r of pdps.filter((x) => !x.is_assigned)) {
      tmp.push({
        seq: 0,
        clickAt: r.txn_at_opened,
        finalAt: r.txn_at_final,
        cat: "Pending DP",
        bankIdForLabel: r.bank_id,
        bankCell: cellForPdp(r),
        desc: `Pending Deposit`,
        amount: Number(r.amount_net || 0),
        creator: r.created_by ? byNameMap[r.created_by] ?? r.created_by : "-",
        bankIdsForFilter: [r.bank_id],
        plainDescForSearch: "pending deposit",
      });
    }

    // PDP ASSIGNED -> route “Depo” (tambahan)
    for (const r of pdps.filter((x) => x.is_assigned)) {
      tmp.push({
        seq: 0,
        clickAt: r.txn_at_opened,                       // waktu click asal PDP
        finalAt: r.assigned_at ?? r.txn_at_final,       // waktu dipilih = assigned_at
        cat: "Depo",
        bankIdForLabel: r.bank_id,
        bankCell: cellForPdpAssignedAsDepo(r),
        desc: `Depo dari ${r.assigned_username_snapshot ?? "-"}`,
        amount: Number(r.amount_net || 0),
        creator: r.created_by ? byNameMap[r.created_by] ?? r.created_by : "-",
        bankIdsForFilter: [r.bank_id],
        plainDescForSearch: `depo ${r.assigned_username_snapshot ?? ""}`.toLowerCase(),
      });
    }

    // TT (Sesama CM) — satu baris saja, finalAt 2 baris (from/to)
    for (const r of tts) {
      tmp.push({
        seq: 0,
        clickAt: r.created_at,                          // Waktu Click TT = created_at
        finalAt: [
          r.from_txn_at,                                // atas = from
          r.to_txn_at,                                  // bawah = to
        ],
        cat: "Sesama CM",
        bankIdForLabel: r.bank_from_id,
        bankCell: cellForTt(r),
        desc: "",                                       // tidak perlu, detail ada di kolom Bank
        amount: Number(r.amount_gross || 0),            // net transfer
        creator: r.created_by ? byNameMap[r.created_by] ?? r.created_by : "-",
        bankIdsForFilter: [r.bank_from_id, r.bank_to_id],
        plainDescForSearch: "transfer antar bank",
      });
    }

    // Adjustment
    for (const r of adjs) {
      tmp.push({
        seq: 0,
        clickAt: r.txn_at_final,
        finalAt: r.txn_at_final,
        cat: "Adjustment",
        bankIdForLabel: r.bank_id,
        bankCell: cellForAdj(r),
        desc: r.description ?? "",
        amount: Number(r.amount_delta || 0),
        creator: r.created_by ? byNameMap[r.created_by] ?? r.created_by : "-",
        bankIdsForFilter: [r.bank_id],
        plainDescForSearch: (r.description ?? "").toLowerCase(),
      });
    }

    // Expense
    for (const r of exps) {
      tmp.push({
        seq: 0,
        clickAt: r.txn_at_final,
        finalAt: r.txn_at_final,
        cat: "Expense",
        bankIdForLabel: r.bank_id,
        bankCell: cellForExp(r),
        desc: r.description ?? "",
        amount: Number(r.amount || 0), // negatif
        creator: r.created_by ? byNameMap[r.created_by] ?? r.created_by : "-",
        bankIdsForFilter: [r.bank_id],
        plainDescForSearch: (r.description ?? "").toLowerCase(),
      });
    }

    // ====== filter Cat/Bank/Desc di memory ======
    let list = tmp;

    if (fCat !== "ALL") {
      list = list.filter((x) => x.cat === fCat);
    }
    if (fBankId !== "ALL") {
      const bid = Number(fBankId);
      list = list.filter((x) => x.bankIdsForFilter.includes(bid));
    }
    if (fDesc.trim()) {
      const q = fDesc.trim().toLowerCase();
      list = list.filter((x) => x.plainDescForSearch.includes(q));
    }

    // ====== sort (Waktu Click desc), penomoran ID (paling atas terbesar) ======
    list.sort(
      (a, b) => new Date(b.clickAt).getTime() - new Date(a.clickAt).getTime()
    );
    const withSeq = list.map((x, idx) => ({ ...x, seq: list.length - idx }));

    // ====== paging =========
    const from = (pageToLoad - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE;
    setTotal(withSeq.length);
    setRows(withSeq.slice(from, to));
    setPage(pageToLoad);
    setBanks((bankData as BankLite[]) ?? []);
    setByMap(byNameMap);
    setLoading(false);
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    load(1);
  };

  /** ====== bank options untuk filter ====== */
  const bankOptions = useMemo(() => {
    return banks.map((b) => ({
      id: b.id,
      label: `[${b.bank_code}] ${b.account_name} - ${b.account_no}`,
    }));
  }, [banks]);

  /** ====== render ====== */
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border bg-white">
        <table className="table-grid min-w-[1100px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            {/* ====== BARIS FILTER (rapat, grid pembatas) ====== */}
            <tr className="filters">
              {/* ID search kecil */}
              <th className="w-16">
                <div className="flex items-center gap-2">
                  <button
                    className="rounded px-2 py-1 border bg-white text-xs"
                    title="Cari ID (urut tampilan)"
                    onClick={() => load(1)}
                  >
                    Cari ID
                  </button>
                </div>
              </th>

              {/* Waktu Click: 2 input date bertumpuk */}
              <th className="w-52">
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

              {/* Waktu Dipilih tidak ada filter */}
              <th className="w-52"></th>

              {/* Cat */}
              <th className="w-36">
                <select
                  value={fCat}
                  onChange={(e) => setFCat(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="ALL">ALL</option>
                  <option value="Depo">Depo</option>
                  <option value="WD">WD</option>
                  <option value="Pending DP">Pending DP</option>
                  <option value="Sesama CM">Sesama CM</option>
                  <option value="Adjustment">Adjustment</option>
                  <option value="Expense">Expense</option>
                </select>
              </th>

              {/* ALL BANK */}
              <th className="w-72">
                <select
                  value={fBankId}
                  onChange={(e) => setFBankId(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                >
                  <option value="ALL">ALL BANK</option>
                  {bankOptions.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </th>

              {/* Search Desc */}
              <th className="w-48">
                <input
                  placeholder="Search desc"
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  className="border rounded px-2 py-1 w-full"
                />
              </th>

              {/* tombol Submit */}
              <th className="w-28">
                <button
                  onClick={apply}
                  className="rounded bg-blue-600 text-white px-3 py-1"
                >
                  Submit
                </button>
              </th>

              {/* Start / Finish / Creator (tak berfilter) */}
              <th></th>
              <th></th>
              <th></th>
            </tr>

            {/* ====== HEADER ====== */}
            <tr>
              <th className="text-left w-16">ID</th>
              <th className="text-left w-52">Waktu Click</th>
              <th className="text-left w-52">Waktu Dipilih</th>
              <th className="text-left w-28">Cat</th>
              <th className="text-left">Bank</th>
              <th className="text-left w-56">Desc</th>
              <th className="text-left w-32">Amount</th>
              <th className="text-left w-28">Start</th>
              <th className="text-left w-28">Finish</th>
              <th className="text-left w-36">Creator</th>
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
              rows.map((r) => (
                <tr key={`${r.cat}-${r.seq}`} className="hover:bg-gray-50">
                  <td>{r.seq}</td>
                  <td>
                    {new Date(r.clickAt).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>
                  <td>
                    {Array.isArray(r.finalAt) ? (
                      <div className="flex flex-col">
                        <span>
                          {new Date(r.finalAt[0]).toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                          })}
                        </span>
                        <span>
                          {new Date(r.finalAt[1]).toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                          })}
                        </span>
                      </div>
                    ) : (
                      new Date(r.finalAt).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })
                    )}
                  </td>
                  <td>{r.cat}</td>
                  <td>{r.bankCell}</td>
                  <td className="whitespace-normal break-words">{r.desc || "—"}</td>
                  <td>{formatAmount(r.amount)}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>{r.creator}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Pagination ===== */}
      <div className="flex justify-center">
        <nav className="inline-flex items-center gap-1 text-sm select-none">
          <button
            onClick={() => canPrev && load(1)}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={() => canPrev && load(page - 1)}
            disabled={!canPrev}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 rounded border bg-white">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => canNext && load(page + 1)}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => canNext && load(totalPages)}
            disabled={!canNext}
            className="px-3 py-1 rounded border bg-white disabled:opacity-50"
          >
            Last
          </button>
        </nav>
      </div>
    </div>
  );
}
