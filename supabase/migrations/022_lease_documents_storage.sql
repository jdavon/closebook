-- Create the lease-documents storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('lease-documents', 'lease-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload PDFs to lease-documents
CREATE POLICY "Authenticated users can upload lease documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'lease-documents');

-- Allow authenticated users to read/download lease documents
CREATE POLICY "Authenticated users can read lease documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'lease-documents');

-- Allow authenticated users to update (overwrite) their uploads
CREATE POLICY "Authenticated users can update lease documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'lease-documents')
WITH CHECK (bucket_id = 'lease-documents');

-- Allow authenticated users to delete their uploads
CREATE POLICY "Authenticated users can delete lease documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'lease-documents');
