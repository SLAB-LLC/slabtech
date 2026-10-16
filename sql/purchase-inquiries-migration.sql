-- Create purchase_inquiries table to store customer purchase requests
CREATE TABLE IF NOT EXISTS purchase_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Product information
  product_type TEXT NOT NULL CHECK (product_type IN ('hoodie', 'individual', 'company')),

  -- Customer contact information
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,

  -- Individual tier specific fields
  industry TEXT CHECK (industry IN ('Pest', 'Roofing', 'Solar', 'Fiber')),
  payment_plan TEXT CHECK (payment_plan IN ('summer', 'monthly')),

  -- Custom data (for hoodie customizations, etc.)
  custom_data JSONB,

  -- Additional message from customer
  message TEXT,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'completed', 'cancelled')),

  -- Admin notes
  admin_notes TEXT,
  contacted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS purchase_inquiries_created_at_idx ON purchase_inquiries(created_at DESC);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS purchase_inquiries_status_idx ON purchase_inquiries(status);

-- Create index on product_type for filtering
CREATE INDEX IF NOT EXISTS purchase_inquiries_product_type_idx ON purchase_inquiries(product_type);

-- Enable Row Level Security
ALTER TABLE purchase_inquiries ENABLE ROW LEVEL SECURITY;

-- Allow public to insert inquiries (no auth required)
CREATE POLICY "Allow public to insert inquiries"
  ON purchase_inquiries
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Only authenticated admins can view inquiries
CREATE POLICY "Allow admins to view inquiries"
  ON purchase_inquiries
  FOR SELECT
  TO authenticated
  USING (true);

-- Only authenticated admins can update inquiries
CREATE POLICY "Allow admins to update inquiries"
  ON purchase_inquiries
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE purchase_inquiries IS 'Stores customer purchase inquiries for hoodies and platform access';
