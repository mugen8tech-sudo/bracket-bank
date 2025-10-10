export const dynamic = "force-dynamic";
export const revalidate = 0;

import BankManagement from "@/components/bank-management";

export default function BankManagement() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Bank Management</h1>
      <BankManagement />
    </div>
  );
}
