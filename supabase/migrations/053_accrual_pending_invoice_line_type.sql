-- Migration: Add 'pending_invoice' to accrual_close_lines.line_type
-- Pending invoices are NEW/APPROVED in RentalWorks — already invoiced at firm
-- amounts, but not yet synced to QuickBooks. They accrue at 100% of face
-- value (no realization-rate discount) because pricing is already locked.

alter table accrual_close_lines
  drop constraint if exists accrual_close_lines_line_type_check;

alter table accrual_close_lines
  add constraint accrual_close_lines_line_type_check
  check (line_type in ('unbilled_earned', 'timing_accrual', 'timing_deferral', 'pending_invoice'));
