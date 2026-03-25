-- Migration: Document attachments for debt transactions
-- Allows users to upload supporting documents (bank statements, wire confirmations, etc.)
-- to individual transactions in the debt schedule transaction ledger.

create table if not exists debt_transaction_documents (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references debt_transactions(id) on delete cascade,
  file_name       text not null,
  file_path       text not null,
  file_size_bytes bigint,
  uploaded_by     uuid references profiles(id),
  notes           text,
  created_at      timestamptz default now()
);

create index idx_debt_txn_docs_transaction
  on debt_transaction_documents (transaction_id);

-- RLS policies
alter table debt_transaction_documents enable row level security;

create policy "Users can view debt transaction documents for their entities"
  on debt_transaction_documents for select
  using (
    transaction_id in (
      select dt.id from debt_transactions dt
      join debt_instruments di on di.id = dt.debt_instrument_id
      join entities e on e.id = di.entity_id
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can insert debt transaction documents for their entities"
  on debt_transaction_documents for insert
  with check (
    transaction_id in (
      select dt.id from debt_transactions dt
      join debt_instruments di on di.id = dt.debt_instrument_id
      join entities e on e.id = di.entity_id
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can delete debt transaction documents for their entities"
  on debt_transaction_documents for delete
  using (
    transaction_id in (
      select dt.id from debt_transactions dt
      join debt_instruments di on di.id = dt.debt_instrument_id
      join entities e on e.id = di.entity_id
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

-- Storage bucket for debt documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('debt-documents', 'debt-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for debt-documents bucket
CREATE POLICY "Authenticated users can upload debt documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'debt-documents');

CREATE POLICY "Authenticated users can read debt documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'debt-documents');

CREATE POLICY "Authenticated users can update debt documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'debt-documents')
WITH CHECK (bucket_id = 'debt-documents');

CREATE POLICY "Authenticated users can delete debt documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'debt-documents');
