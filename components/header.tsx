// header.tsx
import { supabaseServer } from "@/lib/supabase-server";
import UserMenu from "./user-menu"; // letakkan user-menu.tsx di folder yang sama, atau sesuaikan path

export default async function Header() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  let fullName = "User";
  let brand = "—";

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, tenant_id")
      .eq("user_id", user.id)
      .single();

    fullName = profile?.full_name ?? user.email ?? "User";

    if (profile?.tenant_id) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("slug, name")
        .eq("id", profile.tenant_id)
        .single();

      brand = tenant?.slug || tenant?.name || brand;
    }
  }

  return (
    <header className="w-full border-b bg-white">
      <div className="px-4 h-14 flex items-center justify-between">
        <div className="font-semibold">
          Bracket BANK — <span className="text-sm text-gray-500">{brand}</span>
        </div>

        {/* Menu user di kanan */}
        <UserMenu fullName={fullName} />
      </div>
    </header>
  );
}
