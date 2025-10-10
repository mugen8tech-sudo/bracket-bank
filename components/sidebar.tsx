"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Role = "admin" | "cs" | "viewer" | "loading";

type NavItem = {
  label: string;
  href: string;
  roles: Role[];         // siapa yang boleh melihat
  enabled?: boolean;     // jika false → ditampilkan disabled (placeholder)
};

export default function Sidebar() {
  const pathname = usePathname();
  const supabase = supabaseBrowser();

  const [role, setRole] = useState<Role>("loading");
  const [tenantLabel, setTenantLabel] = useState<string>("—");

  // Normalisasi role dari public.profiles:
  // - 'admin' → admin
  // - 'cs' / 'assops' → cs
  // - 'viewer' / 'agent' → viewer
  function normalizeRole(raw?: string | null): Role {
    if (!raw) return "viewer";
    const r = raw.toLowerCase();
    if (r === "admin") return "admin";
    if (r === "cs" || r === "assops") return "cs";
    if (r === "viewer" || r === "agent") return "viewer";
    return "viewer";
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setRole("viewer");
        return;
      }

      // Ambil role & tenant_id dari profil
      const { data: prof } = await supabase
        .from("profiles")
        .select("role, tenant_id")
        .eq("user_id", user.id)
        .single();

      setRole(normalizeRole(prof?.role));

      // Ambil label tenant (name/slug) – pola sama seperti di banks-table.tsx
      if (prof?.tenant_id) {
        const { data: tenant } = await supabase
          .from("tenants")
          .select("name, slug")
          .eq("id", prof.tenant_id)
          .single();
        setTenantLabel(tenant?.name ?? tenant?.slug ?? "—");
      } else {
        setTenantLabel("—");
      }
    })();
  }, [supabase]);

  // Definisi menu (urut sesuai sidebar)
  const ALL_ITEMS: NavItem[] = [
    { label: "Leads",              href: "/leads",              roles: ["admin", "cs", "viewer"], enabled: true },
    { label: "Banks",              href: "/banks",              roles: ["admin", "cs", "viewer"], enabled: true },
    { label: "Deposits",           href: "/deposits",           roles: ["admin", "cs", "viewer"], enabled: true },
    { label: "Withdrawals",        href: "/withdrawals",        roles: ["admin", "cs", "viewer"], enabled: true },
    { label: "Pending Deposits",   href: "/pending-deposits",   roles: ["admin", "cs", "viewer"], enabled: true },
    { label: "Interbank Transfer", href: "/interbank-transfer", roles: ["admin", "cs", "viewer"], enabled: true },
    { label: "Bank Adjustment",    href: "/bank-adjustments",   roles: ["admin", "cs", "viewer"], enabled: true },
    { label: "Expenses",           href: "/expenses",           roles: ["admin", "cs", "viewer"], enabled: true },
    { label: "Bank Mutation",      href: "/bank-mutation",      roles: ["admin", "cs", "viewer"], enabled: true },

    // Role-based
    { label: "Bank Management",    href: "/bank-management",    roles: ["admin"],                 enabled: true },
    { label: "Credit Topup",       href: "/credit-topup",       roles: ["admin", "cs"],           enabled: true },

    // Placeholder (belum ada halaman) — tetap hanya untuk Admin agar tidak “menggoda” CS/Viewer
    { label: "Credit Adjustment",  href: "#",                   roles: ["admin"],                 enabled: false },
    { label: "Credit Mutation",    href: "#",                   roles: ["admin"],                 enabled: false },
    { label: "Credit Report",      href: "#",                   roles: ["admin"],                 enabled: false },
    { label: "User Management",    href: "/user-management",    roles: ["admin"],                 enabled: false },
  ];

  const visibleItems = useMemo(() => {
    if (role === "loading") return [];
    return ALL_ITEMS.filter((it) => it.roles.includes(role));
  }, [role]);

  const isActive = (href: string) => {
    if (href === "#" || !href) return false;
    // exact match atau prefix (untuk sub-route)
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <aside className="w-[220px] shrink-0 border-r bg-white min-h-[calc(100vh-56px)]">
      <div className="px-3 py-3 font-semibold">{tenantLabel}</div>

      <nav className="px-2 pb-6">
        <ul className="space-y-1">
          {role === "loading" ? (
            // skeleton kecil saat loading (opsional)
            Array.from({ length: 6 }).map((_, i) => (
              <li key={i}>
                <span className="block rounded px-3 py-2 text-sm bg-gray-50 text-gray-400">…</span>
              </li>
            ))
          ) : (
            visibleItems.map((it) => {
              const active = isActive(it.href);
              const cls = clsx(
                "block rounded px-3 py-2 text-sm",
                active ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700 hover:bg-gray-50",
                !it.enabled && "opacity-50 cursor-not-allowed"
              );
              return (
                <li key={it.label}>
                  {it.enabled ? (
                    <Link href={it.href} className={cls}>
                      {it.label}
                    </Link>
                  ) : (
                    <span className={cls}>{it.label}</span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </nav>
    </aside>
  );
}
