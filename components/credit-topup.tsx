"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

/** ====== Role helpers ====== */
type AppRole = "admin" | "cs" | "viewer" | "other";
const normalizeRole = (r?: string | null): AppRole => {
  const v = (r || "").toLowerCase();
  if (v === "admin") return "admin";
  if (v === "cs" || v === "assops") return "cs";
  if (v === "viewer" || v === "agent") return "viewer";
  return "other";
};

/** ====== Currency helpers (ID) ====== */
const nfID = new Intl.NumberFormat("id-ID");
const formatID = (n: number) => (Number.isFinite(n) ? nfID.format(n) : "");
const parseCurrency = (s: string) => {
  // ambil angka & tanda minus/plus saja, buang pemisah ribuan & simbol
  const cleaned = s.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : NaN;
};

/** ====== Date helpers ====== */
const toInputLocal = (d: Date) => {
  // yyyy-MM-ddTHH:mm untuk <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

export default function CreditTopup() {
  const supabase = supabaseBrowser();
  const router = useRouter();

  /** ====== state ====== */
  const [brand, setBrand] = useState<string>("TECH");
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  const [role, setRole] = useState<AppRole>("other");
  const [loading, setLoading] = useState(true);

  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [amountInput, setAmountInput] = useState<string>("");
  const [trxAtInput, setTrxAtInput] = useState<string>(toInputLocal(new Date()));
  const [description, setDescription] = useState<string>("");

  const canSubmit = useMemo(
    () => (role === "admin" || role === "cs") && !submitting,
    [role, submitting]
  );

  /** ====== bootstrap: fetch role, tenant brand & balance ====== */
  useEffect(() => {
    (async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("role, tenant_id")
        .eq("user_id", user.id)
        .single();

      const r = normalizeRole(prof?.role);
      setRole(r);

      if (prof?.tenant_id) {
        const { data: tenant } = await supabase
          .from("tenants")
          .select("slug, name, credit_balance")
          .eq("id", prof.tenant_id)
          .single();

        setBrand(tenant?.slug || tenant?.name || "—");
        setCreditBalance(typeof tenant?.credit_balance === "number" ? tenant!.credit_balance : null);
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ====== handlers ====== */
  const openModal = () => {
    if (role !== "admin" && role !== "cs") {
      alert("Hanya Admin & CS yang bisa melakukan Credit Topup.");
      return;
    }
    setShow(true);
  };

  const resetForm = () => {
    setAmountInput("");
    setTrxAtInput(toInputLocal(new Date()));
    setDescription("");
  };

  const onSubmit = async () => {
    if (role !== "admin" && role !== "cs") {
      alert("Hanya Admin & CS yang bisa melakukan Credit Topup.");
      return;
    }

    const amount = parseCurrency(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Amount harus angka dan > 0.");
      return;
    }

    setSubmitting(true);
    try {
      const p_txn_at = new Date(trxAtInput).toISOString();

      const { error } = await supabase.rpc("perform_tenant_credit_topup", {
        p_amount: amount,
        p_txn_at,
        p_description: description || null,
      });

      if (error) {
        alert(error.message);
        return;
      }

      // refresh saldo tenant (opsional)
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("user_id", user.id)
          .single();
        if (prof?.tenant_id) {
          const { data: t2 } = await supabase
            .from("tenants")
            .select("credit_balance")
            .eq("id", prof.tenant_id)
            .single();
          if (typeof t2?.credit_balance === "number") setCreditBalance(t2.credit_balance);
        }
      }

      alert("Credit Topup berhasil disimpan.");
      setShow(false);
      resetForm();
      router.refresh?.(); // Next 13+; aman kalau undefined
    } finally {
      setSubmitting(false);
    }
  };

  /** ====== UI ====== */
  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="text-sm text-gray-500">Credit Topup — {loading ? "…" : brand}</div>
          <div className="text-xs text-gray-500">
            Credit Balance:&nbsp;
            <span className={creditBalance != null ? "font-semibold" : ""}>
              {creditBalance != null ? formatID(creditBalance) : "—"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openModal}
            disabled={loading || !(role === "admin" || role === "cs")}
            className={`rounded bg-blue-600 px-3 py-2 text-white text-sm
              ${loading || !(role === "admin" || role === "cs") ? "opacity-50 cursor-not-allowed" : ""}`}
            title={
              loading
                ? "Memuat…"
                : role === "admin" || role === "cs"
                ? "Buat Credit Topup"
                : "Hanya Admin & CS"
            }
          >
            New Credit Topup
          </button>
        </div>
      </div>

      {/* Modal sederhana */}
      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[520px] rounded-md bg-white shadow">
            <div className="border-b px-4 py-3 text-sm font-semibold">Credit Topup — {brand}</div>

            <div className="space-y-3 p-4">
              {/* Amount */}
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">Amount</span>
                <input
                  inputMode="numeric"
                  autoFocus
                  placeholder="1.000.000"
                  className="w-full rounded border px-3 py-2"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  onBlur={(e) => {
                    const val = parseCurrency(e.target.value);
                    if (Number.isFinite(val) && val > 0) setAmountInput(formatID(val));
                  }}
                />
              </label>

              {/* Transaction Date */}
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">Transaction Date</span>
                <input
                  type="datetime-local"
                  className="w-[260px] rounded border px-3 py-2"
                  value={trxAtInput}
                  onChange={(e) => setTrxAtInput(e.target.value)}
                />
              </label>

              {/* Description */}
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">Description</span>
                <textarea
                  className="min-h-[90px] w-full resize-y rounded border px-3 py-2"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder=""
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t p-3">
              <button
                type="button"
                onClick={() => {
                  setShow(false);
                  resetForm();
                }}
                className="rounded border px-3 py-2 text-sm"
              >
                Close
              </button>

              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className={`rounded bg-blue-600 px-3 py-2 text-sm text-white ${
                  !canSubmit ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Daftar riwayat bisa ditaruh di sini kalau dibutuhkan */}
    </div>
  );
}
