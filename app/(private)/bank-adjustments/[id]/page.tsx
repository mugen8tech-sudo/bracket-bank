"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatAmount } from "@/lib/format";
import Link from "next/link";

type BA = {
  id: number;
  tenant_id: string;
  bank_id: number;
  amount_delta: number;
  txn_at_final: string;
  description: string | null;
  created_at: string;
  created_by: string | null;
};
type BankLite = { id:number; bank_code:string; account_name:string; account_no:string };
type ProfileLite = { user_id:string; full_name:string|null };

export default function Page({ params }: { params: { id: string } }) {
  const supabase = supabaseBrowser();
  const [row, setRow] = useState<BA | null>(null);
  const [bankStr, setBankStr] = useState("-");
  const [byName, setByName] = useState("-");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("bank_adjustments")
        .select("*")
        .eq("id", Number(params.id))
        .single();
      if (error) { alert(error.message); return; }
      const r = data as BA;

      const { data: b } = await supabase
        .from("banks")
        .select("id, bank_code, account_name, account_no")
        .eq("id", r.bank_id)
        .single();
      if (b) setBankStr(`[${(b as BankLite).bank_code}] ${(b as BankLite).account_name} - ${(b as BankLite).account_no}`);

      if (r.created_by) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .eq("user_id", r.created_by)
          .maybeSingle();
        if (prof) setByName((prof as ProfileLite).full_name ?? r.created_by.slice(0,8));
      }

      setRow(r);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (!row) return <div>Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="text-lg font-semibold">Bank Adjustment Information</div>
      <div className="overflow-hidden rounded border bg-white">
        <table className="table-auto w-full">
          <tbody>
            <tr><td className="border px-4 py-2 w-72">Bank</td><td className="border px-4 py-2">{bankStr}</td></tr>
            <tr><td className="border px-4 py-2">Amount</td><td className="border px-4 py-2">{formatAmount(row.amount_delta)}</td></tr>
            <tr><td className="border px-4 py-2">Description</td><td className="border px-4 py-2">{row.description ?? "-"}</td></tr>
            <tr><td className="border px-4 py-2">Transaction Time</td><td className="border px-4 py-2">{new Date(row.txn_at_final).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td></tr>
            <tr><td className="border px-4 py-2">Confirmation</td><td className="border px-4 py-2">Confirmed by {byName} at {new Date(row.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td></tr>
          </tbody>
        </table>
      </div>

      <Link href="/bank-adjustments" className="rounded bg-gray-100 px-4 py-2 inline-block">Back</Link>
    </div>
  );
}
