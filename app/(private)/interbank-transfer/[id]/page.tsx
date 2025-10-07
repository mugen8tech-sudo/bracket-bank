// app/(private)/interbank-transfer/[id]/page.tsx
type Props = { params: { id: string } };

export const dynamic = "force-dynamic";

export default function InterbankTransferDetailPage({ params }: Props) {
  return (
    <div className="space-y-3">
      <div className="text-xl font-semibold">Interbank Transfer Information</div>
      <div className="rounded border bg-white p-4">
        Detail ID: <b>{params.id}</b> (Placeholder)
      </div>
    </div>
  );
}
