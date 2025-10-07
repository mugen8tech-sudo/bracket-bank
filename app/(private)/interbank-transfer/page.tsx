// app/(private)/interbank-transfer/page.tsx
export const dynamic = "force-dynamic"; // biar tidak di‑prerender

export default function InterbankTransferPage() {
  return (
    <div className="space-y-3">
      <div className="text-xl font-semibold">Interbank Transfers</div>
      {/* Nanti ganti komponen di bawah ini dengan tabel interbank transfer beneran */}
      <div className="rounded border bg-white p-4">
        Halaman Interbank Transfers siap. (Placeholder)
      </div>
    </div>
  );
}
