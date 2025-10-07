# Bracket BANK — CHECKPOINT (v2025-10-07)

## Global
- Timezone UI: **Asia/Jakarta**.
- Format uang: **1,234,567.89** (en-US grouping), input pakai live-grouping.
- Semua modal: bisa tutup via **ESC** dan **klik overlay**.
- Event khusus:
  - **"open-bank-new"** — tombol New Record di BanksTable me-*dispatch* event ini. Listener ada di halaman `/banks`.

## Route (Next.js app routes)
- `/leads`
- `/banks`
- `/deposits`
- `/withdrawals`
- `/pending-deposits`
- `/interbank-transfer`  ← *pakai tanda hubung (bukan plural)*
  - Detail: `/interbank-transfer/[id]`

## Supabase – Tabel & kolom yang sudah dipakai UI
### `profiles`
- `user_id` (uuid, PK), `tenant_id` (uuid) — **RLS**: user hanya lihat tenant-nya.

### `tenants`
- `id` (uuid), `name` (text), `credit_balance` (numeric)

### `tenant_settings`
- `tenant_id` (uuid), `bank_direct_fee_hits_credit` (boolean)  
  - ON → credit dikurangi **NET**  
  - OFF → credit dikurangi **GROSS**

### `banks`
- **Dipakai di UI (BanksTable):**
- `id` (bigint), `tenant_id` (uuid), `bank_code` (text), `account_name` (text), `account_no` (text),
  `usage_type` enum: `deposit` | `withdraw` | `neutral`,
  `is_active` (bool), `is_pulsa` (bool), `direct_fee_enabled` (bool), `direct_fee_percent` (numeric),
  `balance` (numeric)

### `leads`
- **Dipakai di UI (LeadsTable):**
- `id` (bigint), `tenant_id` (uuid), `name` (text), `bank` (text), `bank_name` (text),
  `bank_no` (text), `phone_number` (text), `username` (text),
  `registration_date` (timestamptz)
- **Unik per tenant** (partial index): `(tenant_id, bank_no)` bila `bank_no` tidak kosong; `(tenant_id, phone_number)` bila `phone_number` tidak kosong.
- **Validasi UI**: `bank_no` & `phone_number` wajib diisi saat buat/edit lead.

### `deposits` / `withdrawals` (ringkas)
- Disesuaikan dengan RPC di bawah; field wajib untuk UI: `id`, `lead`, `username`, `amount_gross`, `net`, `txn_at`, `by`, `deleted?` (boolean), dll.

### `pending_deposits`
- PDP dicatat di sini; **saat submit PDP**: naikkan `banks.balance` sebesar **NET** (memperhitungkan potongan langsung bank). Credit & transaksi tenant **tidak** naik di tahap ini.
- **Assign PDP**: credit & total transaksi tenant **bertambah** (net/gross sesuai setting). Bank balance **tidak** bertambah lagi.
- **Delete PDP**: bank balance **berkurang** sebesar amount yang dihapus; credit & transaksi tenant **tidak berubah**.

### `interbank_transfers`  (struktur yang dipakai UI)
- Kolom: `id`, `tenant_id`, `bank_from_id`, `bank_to_id`, `amount_gross`, `fee_amount`,
  `from_txn_at`, `to_txn_at`, `description`, `created_at`, `created_by`.

## Supabase – RPC yang dipanggil UI
- `perform_deposit(p_bank_id, p_lead_id, p_username, p_amount_gross, p_txn_at_opened, p_txn_at_final, p_promo_code, p_description)`
- `perform_withdrawal(p_bank_id, p_lead_id, p_username, p_amount_gross, p_transfer_fee_amount, p_txn_at_opened, p_txn_at_final, p_description)`
- `create_pending_deposit(p_bank_id, p_amount_gross, p_txn_at_opened, p_txn_at_final, p_description)`
- `assign_pending_deposit(p_pending_id, p_lead_id, p_username, p_txn_at_final)`  → efek: credit+transaksi tenant naik; bank balance tidak berubah.
- `delete_pending_deposit(p_pending_id, p_reason)` → efek: bank balance turun; credit+transaksi tenant tidak berubah.
- (TT) `perform_interbank_transfer(p_from_bank_id, p_to_bank_id, p_amount_gross, p_fee_amount, p_from_txn_at, p_to_txn_at, p_description)`

## UI Kontrak (komponen utama)
- **BanksTable**: menampilkan saldo bank & aksi DP/WD/PDP, setting direct-fee→credit, tombol **New Record** mem-broadcast `open-bank-new`. Panggil RPC deposit/withdrawal/pending-deposit seperti di kode. :contentReference[oaicite:6]{index=6}
- **LeadsTable**: pagination 25, filter di baris atas, form New/Edit wajib isi `username, name, bank_name, bank, bank_no, phone_number`, dan validasi bebas duplikasi `bank_no` & `phone_number` per tenant. :contentReference[oaicite:7]{index=7}

## Gaya Tabel/Modal
- Tabel bergaya “grid excel”, filter input di atas header; tombol aksi rata & seragam.
- Modal: ESC & klik overlay → close; Enter di form → submit.
