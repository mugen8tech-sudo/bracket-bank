import { supabaseServer } from "@/lib/supabase-server";

export default async function Header() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  let fullName = "User";
  let brand = "—"; // fallback jika tenant tidak ditemukan

  if (user) {
    // ambil profil (termasuk tenant_id)
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, tenant_id")
      .eq("user_id", user.id)
      .single();

    fullName = profile?.full_name ?? user.email ?? "User";

    // lookup tenant → pakai slug kalau ada, else name
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
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-700">{fullName}</span>
          <form action="/api/auth/signout" method="post">
            <button className="rounded bg-gray-100 hover:bg-gray-200 px-3 py-1 text-sm">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
