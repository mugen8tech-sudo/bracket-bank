"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";
import Link from "next/link";

type TT = {
  id: number;
  tenant_id: string;
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

type BankLite = { id:number; bank_code:string; account_name:string; account_no:string };
type ProfileLite = { user_id:string; full_name:string|null };

export default function Page({ params }: { params: { id: string } }) {
  const supabase = supabaseBrowser();
  const [row, setRow] = useState<TT | null>(null);
  const [fromStr, setFromStr] = useState("-");
  const [toStr, setToStr] = useState("-");
  const [byName, setByName] = useState("-");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("interbank_transfers")
        .select("*")
        .eq("id", Number(params.id))
        .single();
      if (error) { alert(error.message); return; }
      const r = data as TT;

      const { data: banks } = await supabase
        .from("banks")
        .select("id, bank_code, account_name, account_no")
        .in("id", [r.bank_from_id, r.bank_to_id]);

      const m = new Map<number, BankLite>();
      (banks ?? []).forEach((b: any) => m.set(b.id, b));

      const f = m.get(r.bank_from_id);
      const t = m.get(r.bank_to_id);
      setFromStr(f ? `[${f.bank_code}] ${f.account_name} - ${f.account_no}` : `#${r.bank_from_id}`);
      setToStr(t ? `[${t.bank_code}] ${t.account_name} - ${t.account_no}` : `#${r.bank_to_id}`);

      if (r.created_by) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .eq("user_id", r.created_by)
          .maybeSingle();
        if (prof) setByName((prof as ProfileLite).full_name ?? (r.created_by.slice(0,8)));
      }

      setRow(r);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (!row) return <div>Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="text-lg font-semibold">Interbank Transfer Information</div>
      <div className="overflow-hidden rounded border bg-white">
        <table className="table-auto w-full">
          <tbody>
            <tr><td className="border px-4 py-2 w-72">Bank Asal</td><td className="border px-4 py-2">{fromStr}</td></tr>
            {/* Open/Close balance TIDAK digunakan */}
            <tr><td className="border px-4 py-2">Bank Asal Transaction Time</td><td className="border px-4 py-2">{new Date(row.from_txn_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td></tr>
            <tr><td className="border px-4 py-2">Amount</td><td className="border px-4 py-2">{formatAmount(row.amount_gross)}</td></tr>
            <tr><td className="border px-4 py-2">Biaya Transfer</td><td className="border px-4 py-2">{formatAmount(row.fee_amount)}</td></tr>
            <tr><td className="border px-4 py-2">Description</td><td className="border px-4 py-2">{row.description ?? "-"}</td></tr>
            <tr><td className="border px-4 py-2">Bank Tujuan</td><td className="border px-4 py-2">{toStr}</td></tr>
            {/* Open/Close balance TIDAK digunakan */}
            <tr><td className="border px-4 py-2">Bank Tujuan Transaction Time</td><td className="border px-4 py-2">{new Date(row.to_txn_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td></tr>
            <tr><td className="border px-4 py-2">Confirmation</td><td className="border px-4 py-2">Confirmed by {byName} at {new Date(row.created_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td></tr>
          </tbody>
        </table>
      </div>

      <Link href="/interbank-transfer" className="rounded bg-gray-100 px-4 py-2 inline-block">Back</Link>
    </div>
  );
}
