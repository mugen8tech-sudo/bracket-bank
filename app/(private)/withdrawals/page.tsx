export const dynamic = "force-dynamic";
export const revalidate = 0;

import WithdrawalsTable from "@/components/withdrawals-table";

export default function WithdrawalsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Withdrawals</h1>
      <WithdrawalsTable />
    </div>
  );
}
