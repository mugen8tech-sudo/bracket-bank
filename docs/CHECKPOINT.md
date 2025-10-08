# Bracket BANK — CHECKPOINT (v2025-10-08)

## Global
- Timezone UI: Asia/Jakarta.
- Format uang: 1,234,567.89 (en-US grouping) + input pakai live-grouping.
- Modal: ESC & klik overlay → close; ENTER di form → submit.
- Event khusus:
  - "open-bank-new" — tombol New Record di BanksTable me-dispatch event ini (listener di halaman /banks).

## Route (App Router)
- /leads
- /banks
- /deposits
- /withdrawals
- /pending-deposits
- /interbank-transfer       ← singular
  - Detail: /interbank-transfer/[id]

## Supabase – Tabel (yang dipakai UI)
### profiles
- user_id (uuid, PK), tenant_id (uuid) — RLS: user hanya melihat tenant-nya.

### tenants
- id (uuid), name (text), credit_balance (numeric).

### tenant_settings
- tenant_id (uuid), bank_direct_fee_hits_credit (boolean)
  - ON → credit tenant dikurangi NET
  - OFF → credit tenant dikurangi GROSS
  - Catatan implementasi saat ini: jika row belum ada, UI fallback menganggap ON. Disarankan seed baris default sesuai kebijakan bisnis.

### banks
- id (bigint), tenant_id (uuid), bank_code (text), account_name (text), account_no (text),
  usage_type enum: deposit | withdraw | neutral,
  is_active (bool), is_pulsa (bool), direct_fee_enabled (bool), direct_fee_percent (numeric),
  balance (numeric).

### leads
- id (bigint), tenant_id (uuid), name (text), bank (text), bank_name (text),
  bank_no (text), phone_number (text), username (text), registration_date (timestamptz).
- Unik per tenant (disarankan indeks/constraint):
  (tenant_id, bank_no) bila bank_no tidak kosong;
  (tenant_id, phone_number) bila phone_number tidak kosong.
- Validasi UI saat create/update: bank_no & phone_number wajib, dan anti-duplikat per tenant.

### deposits / withdrawals
- Mengikuti hasil RPC. Field yang dipakai UI: id, lead_name_snapshot, username_snapshot,
  amount_gross/net, fee_direct_amount (deposit), txn_at_final, created_by, is_deleted, dst.

### pending_deposits
- Submit PDP: naikkan banks.balance sebesar *NET* (memperhitungkan direct fee bank).
- Assign PDP: credit & total transaksi tenant bertambah (NET/GROSS sesuai setting).
  **Bank tidak bertambah lagi**.
- Delete PDP: banks.balance berkurang; credit & transaksi tenant **tidak berubah**.

### interbank_transfers
- id, tenant_id, bank_from_id, bank_to_id, amount_gross, fee_amount,
  from_txn_at, to_txn_at, description, created_at, created_by.

## Supabase – RPC yang dipanggil UI (signature sesuai implementasi aktif)
- perform_deposit(
    p_bank_id, p_lead_id, p_username,
    p_amount_gross, p_txn_at_opened, p_txn_at_final,
    p_promo_code, p_description
  )
- perform_withdrawal(
    p_bank_id, p_lead_id, p_username,
    p_amount_gross, p_transfer_fee_amount,
    p_txn_at_opened, p_txn_at_final, p_description
  )
- create_pending_deposit(
    p_bank_id, p_amount_gross,
    p_txn_at_opened, p_txn_at_final, p_description
  )
- assign_pending_deposit(
    p_pending_id, p_lead_id, p_username, p_txn_at_final
  )
- delete_pending_deposit(
    p_pending_id, p_delete_note
  )
- perform_interbank_transfer(
    p_bank_from_id, p_bank_to_id,
    p_amount_gross, p_transfer_fee_amount,
    p_from_txn_at, p_to_txn_at, p_description
  )
- Tambahan (dipakai UI):
  delete_deposit(p_deposit_id, p_delete_note)

## UI Kontrak (pola yang sudah work)
- **BanksTable**:
  - Tanpa paginasi; kolom menampilkan saldo & tombol aksi: DP, WD, PDP, TT.
  - Modal “Setting Potongan → Credit” mengelola tenant_settings.bank_direct_fee_hits_credit.
  - Tombol “New Record” → dispatch "open-bank-new".
- **LeadsTable**:
  - Paginasi 25; baris **filter input** di atas header (grid excel).
  - Form New/Edit: field wajib username, name, bank_name, bank, bank_no, phone_number + anti-duplikat bank_no/phone_number per tenant.
- **DepositsTable**:
  - Paginasi 100; filter tanggal (TZ Asia/Jakarta); ringkasan hari ini (sum net, count, unique players).
  - Aksi Delete deposit → RPC delete_deposit(p_deposit_id, p_delete_note).
- **PendingDepositsTable**:
  - Paginasi 25; filter tanggal & status; badge “not assigned”.
  - Assign → RPC assign_pending_deposit(...); Delete → delete_pending_deposit(p_pending_id, p_delete_note).
- **InterbankTransfersTable**:
  - Paginasi 100; filter tanggal berdasarkan created_at; kolom Bank Asal/Tujuan di-label dari tabel banks; tombol “Detail” → /interbank-transfer/[id].

## Pencarian Player (DP/WD & Assign PDP)
- Input username menggunakan .ilike("username", q) **tanpa wildcard** (perilaku saat ini).
- LeadsTable untuk filter umum tetap gunakan pattern `%...%` pada kolom teks.

## Konvensi Tampilan
- Tabel “grid excel”; tombol aksi konsisten; amount rata kiri di beberapa tabel (sesuai implementasi).
- Semua tanggal ditampilkan dengan toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }).
- Input uang dengan live-grouping; normalisasi ke number saat submit.
