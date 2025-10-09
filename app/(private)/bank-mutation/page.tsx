"use client";

import dynamic from "next/dynamic";

// hindari SSR untuk akses Supabase browser
const BankMutationsTable = dynamic(
  () => import("@/components/bank-mutations-table"),
  { ssr: false }
);

export default function Page() {
  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">Bank Mutation</div>
      <BankMutationsTable />
    </div>
  );
}
