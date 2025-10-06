export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { formatAmount } from "@/lib/format";

export default async function WithdrawalDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerComponentClient({ cookies });
  const id = Number(params.id);

  const { data: wd, error } = await supabase
    .from("withdrawals")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !wd) {
    return <div className="rounded border bg-white p-4">Withdrawal not found.</div>;
  }

  const { data: bank } = await supabase
    .from("banks")
    .select("bank_code, account_name, account_no")
    .eq("id", wd.bank_id)
    .single();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", wd.tenant_id)
    .single();

  let createdByName: string | null = wd.created_by;
  if (wd.created_by) {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", wd.created_by)
      .single();
    createdByName = p?.full_name ?? wd.created_by;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Withdrawal Information</h1>
      <div className="rounded border bg-white">
        <table className="table-grid w-full">
          <tbody>
            <tr><td className="w-48">Lead</td><td>{wd.lead_name_snapshot ?? "-"}</td></tr>
            <tr><td>Bank</td><td>[{bank?.bank_code}] {bank?.account_name} - {bank?.account_no}</td></tr>
            <tr><td>Amount (Gross)</td><td>{formatAmount(wd.amount_gross)}</td></tr>
            <tr><td>Transfer Fee</td><td>{formatAmount(wd.transfer_fee_amount)}</td></tr>
            <tr><td>Net</td><td>{formatAmount(wd.amount_net)}</td></tr>
            <tr><td>Transaction Time</td><td>{new Date(wd.txn_at_final).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td></tr>
            <tr><td>Player</td><td>{wd.username_snapshot}</td></tr>
            <tr><td>Website</td><td>{tenant?.name ?? "-"}</td></tr>
            <tr><td>By</td><td>{createdByName ?? "-"}</td></tr>
            <tr><td>Deleted?</td><td>{wd.is_deleted ? "YES" : "NO"}</td></tr>
            {wd.is_deleted && (
              <>
                <tr><td>Deleted At</td><td>{new Date(wd.deleted_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td></tr>
                <tr><td>Delete Note</td><td>{wd.delete_note}</td></tr>
              </>
            )}
            <tr><td>Description</td><td>{wd.description ?? "-"}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
