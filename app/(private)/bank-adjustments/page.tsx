import dynamic from "next/dynamic";
const BankAdjustmentsTable = dynamic(() => import("@/components/bank-adjustments-table"), { ssr: false });

export default function Page() {
  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">Bank Adjustments</div>
      <BankAdjustmentsTable />
    </div>
  );
}
