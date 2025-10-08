import dynamic from "next/dynamic";
const ExpensesTable = dynamic(() => import("@/components/expenses-table"), { ssr: false });

export default function Page() {
  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">Expenses</div>
      <ExpensesTable />
    </div>
  );
}
