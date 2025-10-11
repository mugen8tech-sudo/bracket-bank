// user-menu.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Props = { fullName: string };

export default function UserMenu({ fullName }: Props) {
  const [open, setOpen] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");

  const menuRef = useRef<HTMLDivElement | null>(null);
  const supabase = supabaseBrowser();

  // klik di luar untuk menutup dropdown
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!pwd || pwd.length < 8) {
      setMsg({ type: "err", text: "Password minimal 8 karakter." });
      return;
    }
    if (pwd !== confirm) {
      setMsg({ type: "err", text: "Konfirmasi password tidak sama." });
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setLoading(false);

    if (error) {
      setMsg({ type: "err", text: error.message || "Gagal mengubah password." });
      return;
    }

    setMsg({ type: "ok", text: "Password berhasil diubah." });
    setPwd("");
    setConfirm("");

    // opsional: tutup modal setelah sukses singkat
    setTimeout(() => {
      setShowPwd(false);
      setMsg(null);
    }, 800);
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200"
      >
        <span className="truncate max-w-[160px]">{fullName}</span>
        <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 7l5 6 5-6H5z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-40 rounded border bg-white shadow-md z-20">
          <button
            className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => {
              setShowPwd(true);
              setOpen(false);
            }}
          >
            Password
          </button>

          {/* Sign out via form POST seperti implementasi sebelumnya */}
          <form action="/api/auth/signout" method="post">
            <button
              className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>
      )}

      {/* Modal Ubah Password */}
      {showPwd && (
        <div className="fixed inset-0 z-30 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowPwd(false)} />
          <div className="relative z-40 w-full max-w-sm rounded-lg border bg-white p-4 shadow-lg">
            <h3 className="mb-2 text-sm font-semibold">Ganti Password</h3>
            <form onSubmit={onChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Password baru</label>
                <input
                  type="password"
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Konfirmasi password</label>
                <input
                  type="password"
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              {msg && (
                <p className={`text-xs ${msg.type === "ok" ? "text-green-600" : "text-red-600"}`}>
                  {msg.text}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPwd(false)}
                  className="rounded px-3 py-1.5 text-sm border hover:bg-gray-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded px-3 py-1.5 text-sm bg-blue-600 text-white disabled:opacity-60"
                >
                  {loading ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
