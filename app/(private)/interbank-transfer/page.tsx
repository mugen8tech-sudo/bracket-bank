import InterbankTransfersTable from "@/components/interbank-transfers-table";

export default function Page() {
  return (
    <div className="space-y-4">
      <div className="text-lg font-semibold">Interbank Transfers</div>
      <InterbankTransfersTable />
    </div>
  );
}
