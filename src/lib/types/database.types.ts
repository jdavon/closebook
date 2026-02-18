export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string
          entity_id: string
          qbo_id: string | null
          account_number: string | null
          name: string
          fully_qualified_name: string | null
          classification: string
          account_type: string
          account_sub_type: string | null
          parent_account_id: string | null
          is_active: boolean
          currency: string
          current_balance: number
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          qbo_id?: string | null
          account_number?: string | null
          name: string
          fully_qualified_name?: string | null
          classification: string
          account_type: string
          account_sub_type?: string | null
          parent_account_id?: string | null
          is_active?: boolean
          currency?: string
          current_balance?: number
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          qbo_id?: string | null
          account_number?: string | null
          name?: string
          fully_qualified_name?: string | null
          classification?: string
          account_type?: string
          account_sub_type?: string | null
          parent_account_id?: string | null
          is_active?: boolean
          currency?: string
          current_balance?: number
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          organization_id: string
          entity_id: string | null
          user_id: string | null
          action: string
          resource_type: string
          resource_id: string | null
          old_values: Json | null
          new_values: Json | null
          ip_address: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          entity_id?: string | null
          user_id?: string | null
          action: string
          resource_type: string
          resource_id?: string | null
          old_values?: Json | null
          new_values?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          entity_id?: string | null
          user_id?: string | null
          action?: string
          resource_type?: string
          resource_id?: string | null
          old_values?: Json | null
          new_values?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Relationships: []
      }
      close_periods: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          status: string
          due_date: string | null
          notes: string | null
          opened_at: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          status?: string
          due_date?: string | null
          notes?: string | null
          opened_at?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          status?: string
          due_date?: string | null
          notes?: string | null
          opened_at?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      close_task_attachments: {
        Row: {
          id: string
          close_task_id: string
          file_name: string
          file_path: string
          file_size: number | null
          mime_type: string | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          close_task_id: string
          file_name: string
          file_path: string
          file_size?: number | null
          mime_type?: string | null
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          close_task_id?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          mime_type?: string | null
          uploaded_by?: string
          created_at?: string
        }
        Relationships: []
      }
      close_task_comments: {
        Row: {
          id: string
          close_task_id: string
          user_id: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          close_task_id: string
          user_id: string
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          close_task_id?: string
          user_id?: string
          content?: string
          created_at?: string
        }
        Relationships: []
      }
      close_task_templates: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          category: string | null
          default_role: string | null
          account_classification: string | null
          account_type: string | null
          relative_due_day: number | null
          display_order: number
          is_active: boolean
          requires_reconciliation: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          category?: string | null
          default_role?: string | null
          account_classification?: string | null
          account_type?: string | null
          relative_due_day?: number | null
          display_order?: number
          is_active?: boolean
          requires_reconciliation?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          category?: string | null
          default_role?: string | null
          account_classification?: string | null
          account_type?: string | null
          relative_due_day?: number | null
          display_order?: number
          is_active?: boolean
          requires_reconciliation?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      close_tasks: {
        Row: {
          id: string
          close_period_id: string
          template_id: string | null
          account_id: string | null
          name: string
          description: string | null
          category: string | null
          status: string
          preparer_id: string | null
          reviewer_id: string | null
          due_date: string | null
          completed_at: string | null
          reviewed_at: string | null
          preparer_notes: string | null
          reviewer_notes: string | null
          gl_balance: number | null
          reconciled_balance: number | null
          variance: number | null
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          close_period_id: string
          template_id?: string | null
          account_id?: string | null
          name: string
          description?: string | null
          category?: string | null
          status?: string
          preparer_id?: string | null
          reviewer_id?: string | null
          due_date?: string | null
          completed_at?: string | null
          reviewed_at?: string | null
          preparer_notes?: string | null
          reviewer_notes?: string | null
          gl_balance?: number | null
          reconciled_balance?: number | null
          variance?: number | null
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          close_period_id?: string
          template_id?: string | null
          account_id?: string | null
          name?: string
          description?: string | null
          category?: string | null
          status?: string
          preparer_id?: string | null
          reviewer_id?: string | null
          due_date?: string | null
          completed_at?: string | null
          reviewed_at?: string | null
          preparer_notes?: string | null
          reviewer_notes?: string | null
          gl_balance?: number | null
          reconciled_balance?: number | null
          variance?: number | null
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      entities: {
        Row: {
          id: string
          organization_id: string
          name: string
          code: string
          currency: string
          fiscal_year_end_month: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          code: string
          currency?: string
          fiscal_year_end_month?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          code?: string
          currency?: string
          fiscal_year_end_month?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      entity_access: {
        Row: {
          id: string
          entity_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          user_id: string
          role: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          user_id?: string
          role?: string
          created_at?: string
        }
        Relationships: []
      }
      generated_reports: {
        Row: {
          id: string
          entity_id: string
          report_definition_id: string | null
          period_year: number
          period_month: number
          report_data: Json
          comparison_data: Json | null
          generated_at: string
          generated_by: string | null
        }
        Insert: {
          id?: string
          entity_id: string
          report_definition_id?: string | null
          period_year: number
          period_month: number
          report_data: Json
          comparison_data?: Json | null
          generated_at?: string
          generated_by?: string | null
        }
        Update: {
          id?: string
          entity_id?: string
          report_definition_id?: string | null
          period_year?: number
          period_month?: number
          report_data?: Json
          comparison_data?: Json | null
          generated_at?: string
          generated_by?: string | null
        }
        Relationships: []
      }
      gl_balances: {
        Row: {
          id: string
          entity_id: string
          account_id: string
          period_year: number
          period_month: number
          beginning_balance: number
          debit_total: number
          credit_total: number
          ending_balance: number
          net_change: number
          synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          account_id: string
          period_year: number
          period_month: number
          beginning_balance?: number
          debit_total?: number
          credit_total?: number
          ending_balance?: number
          net_change?: number
          synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          account_id?: string
          period_year?: number
          period_month?: number
          beginning_balance?: number
          debit_total?: number
          credit_total?: number
          ending_balance?: number
          net_change?: number
          synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      kpi_definitions: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          formula: Json
          format: string
          target_value: number | null
          display_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          formula: Json
          format?: string
          target_value?: number | null
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          formula?: Json
          format?: string
          target_value?: number | null
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      kpi_values: {
        Row: {
          id: string
          kpi_definition_id: string
          entity_id: string
          period_year: number
          period_month: number
          value: number | null
          computed_at: string
        }
        Insert: {
          id?: string
          kpi_definition_id: string
          entity_id: string
          period_year: number
          period_month: number
          value?: number | null
          computed_at?: string
        }
        Update: {
          id?: string
          kpi_definition_id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          value?: number | null
          computed_at?: string
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          role: string
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          role?: string
          created_at?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_connections: {
        Row: {
          id: string
          entity_id: string
          realm_id: string
          access_token: string
          refresh_token: string
          access_token_expires_at: string
          refresh_token_expires_at: string
          company_name: string | null
          last_sync_at: string | null
          sync_status: string
          sync_error: string | null
          connected_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          realm_id: string
          access_token: string
          refresh_token: string
          access_token_expires_at: string
          refresh_token_expires_at: string
          company_name?: string | null
          last_sync_at?: string | null
          sync_status?: string
          sync_error?: string | null
          connected_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          realm_id?: string
          access_token?: string
          refresh_token?: string
          access_token_expires_at?: string
          refresh_token_expires_at?: string
          company_name?: string | null
          last_sync_at?: string | null
          sync_status?: string
          sync_error?: string | null
          connected_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_sync_logs: {
        Row: {
          id: string
          qbo_connection_id: string
          sync_type: string
          status: string
          records_synced: number
          error_message: string | null
          started_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          qbo_connection_id: string
          sync_type: string
          status: string
          records_synced?: number
          error_message?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          qbo_connection_id?: string
          sync_type?: string
          status?: string
          records_synced?: number
          error_message?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      report_definitions: {
        Row: {
          id: string
          organization_id: string
          name: string
          report_type: string
          config: Json
          is_system: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          report_type: string
          config: Json
          is_system?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          report_type?: string
          config?: Json
          is_system?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_line_items: {
        Row: {
          id: string
          schedule_id: string
          row_order: number
          is_header: boolean
          is_total: boolean
          cell_data: Json
          amount: number
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          schedule_id: string
          row_order: number
          is_header?: boolean
          is_total?: boolean
          cell_data?: Json
          amount?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          schedule_id?: string
          row_order?: number
          is_header?: boolean
          is_total?: boolean
          cell_data?: Json
          amount?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_templates: {
        Row: {
          id: string
          organization_id: string
          name: string
          schedule_type: string
          column_definitions: Json
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          schedule_type: string
          column_definitions: Json
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          schedule_type?: string
          column_definitions?: Json
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedules: {
        Row: {
          id: string
          entity_id: string
          template_id: string | null
          close_period_id: string | null
          close_task_id: string | null
          account_id: string | null
          name: string
          schedule_type: string
          column_definitions: Json
          status: string
          total_amount: number
          gl_balance: number | null
          variance: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          template_id?: string | null
          close_period_id?: string | null
          close_task_id?: string | null
          account_id?: string | null
          name: string
          schedule_type: string
          column_definitions: Json
          status?: string
          total_amount?: number
          gl_balance?: number | null
          variance?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          template_id?: string | null
          close_period_id?: string | null
          close_task_id?: string | null
          account_id?: string | null
          name?: string
          schedule_type?: string
          column_definitions?: Json
          status?: string
          total_amount?: number
          gl_balance?: number | null
          variance?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      trial_balances: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          synced_at: string
          report_data: Json
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          synced_at?: string
          report_data: Json
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          synced_at?: string
          report_data?: Json
          status?: string
          created_at?: string
        }
        Relationships: []
      }
      uploaded_reports: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          name: string
          description: string | null
          file_name: string
          file_path: string
          file_size: number | null
          mime_type: string | null
          category: string | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          name: string
          description?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          mime_type?: string | null
          category?: string | null
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          name?: string
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          mime_type?: string | null
          category?: string | null
          uploaded_by?: string
          created_at?: string
        }
        Relationships: []
      }
      fixed_assets: {
        Row: {
          id: string
          entity_id: string
          asset_name: string
          asset_tag: string | null
          vehicle_year: number | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_trim: string | null
          vin: string | null
          license_plate: string | null
          license_state: string | null
          mileage_at_acquisition: number | null
          vehicle_class: string | null
          title_number: string | null
          registration_expiry: string | null
          vehicle_notes: string | null
          acquisition_date: string
          acquisition_cost: number
          in_service_date: string
          book_useful_life_months: number
          book_salvage_value: number
          book_depreciation_method: string
          book_accumulated_depreciation: number
          book_net_value: number
          tax_cost_basis: number | null
          tax_depreciation_method: string
          tax_useful_life_months: number | null
          tax_accumulated_depreciation: number
          tax_net_value: number
          section_179_amount: number
          bonus_depreciation_amount: number
          cost_account_id: string | null
          accum_depr_account_id: string | null
          depr_expense_account_id: string | null
          status: string
          disposed_date: string | null
          disposed_sale_price: number | null
          disposed_book_gain_loss: number | null
          disposed_tax_gain_loss: number | null
          disposition_method: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          asset_name: string
          asset_tag?: string | null
          vehicle_year?: number | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vin?: string | null
          license_plate?: string | null
          license_state?: string | null
          mileage_at_acquisition?: number | null
          vehicle_class?: string | null
          title_number?: string | null
          registration_expiry?: string | null
          vehicle_notes?: string | null
          acquisition_date: string
          acquisition_cost: number
          in_service_date: string
          book_useful_life_months?: number
          book_salvage_value?: number
          book_depreciation_method?: string
          book_accumulated_depreciation?: number
          tax_cost_basis?: number | null
          tax_depreciation_method?: string
          tax_useful_life_months?: number | null
          tax_accumulated_depreciation?: number
          section_179_amount?: number
          bonus_depreciation_amount?: number
          cost_account_id?: string | null
          accum_depr_account_id?: string | null
          depr_expense_account_id?: string | null
          status?: string
          disposed_date?: string | null
          disposed_sale_price?: number | null
          disposed_book_gain_loss?: number | null
          disposed_tax_gain_loss?: number | null
          disposition_method?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          asset_name?: string
          asset_tag?: string | null
          vehicle_year?: number | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vin?: string | null
          license_plate?: string | null
          license_state?: string | null
          mileage_at_acquisition?: number | null
          vehicle_class?: string | null
          title_number?: string | null
          registration_expiry?: string | null
          vehicle_notes?: string | null
          acquisition_date?: string
          acquisition_cost?: number
          in_service_date?: string
          book_useful_life_months?: number
          book_salvage_value?: number
          book_depreciation_method?: string
          book_accumulated_depreciation?: number
          tax_cost_basis?: number | null
          tax_depreciation_method?: string
          tax_useful_life_months?: number | null
          tax_accumulated_depreciation?: number
          section_179_amount?: number
          bonus_depreciation_amount?: number
          cost_account_id?: string | null
          accum_depr_account_id?: string | null
          depr_expense_account_id?: string | null
          status?: string
          disposed_date?: string | null
          disposed_sale_price?: number | null
          disposed_book_gain_loss?: number | null
          disposed_tax_gain_loss?: number | null
          disposition_method?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_cost_account_id_fkey"
            columns: ["cost_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_accum_depr_account_id_fkey"
            columns: ["accum_depr_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_depr_expense_account_id_fkey"
            columns: ["depr_expense_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_asset_depreciation: {
        Row: {
          id: string
          fixed_asset_id: string
          period_year: number
          period_month: number
          book_depreciation: number
          book_accumulated: number
          book_net_value: number
          tax_depreciation: number
          tax_accumulated: number
          tax_net_value: number
          is_manual_override: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fixed_asset_id: string
          period_year: number
          period_month: number
          book_depreciation?: number
          book_accumulated?: number
          book_net_value?: number
          tax_depreciation?: number
          tax_accumulated?: number
          tax_net_value?: number
          is_manual_override?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fixed_asset_id?: string
          period_year?: number
          period_month?: number
          book_depreciation?: number
          book_accumulated?: number
          book_net_value?: number
          tax_depreciation?: number
          tax_accumulated?: number
          tax_net_value?: number
          is_manual_override?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_asset_depreciation_fixed_asset_id_fkey"
            columns: ["fixed_asset_id"]
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      paylocity_connections: {
        Row: {
          id: string
          entity_id: string
          client_id: string
          client_secret_encrypted: string
          access_token: string | null
          token_expires_at: string | null
          environment: string
          company_id: string
          connected_by: string | null
          last_sync_at: string | null
          sync_status: string
          sync_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          client_id: string
          client_secret_encrypted: string
          access_token?: string | null
          token_expires_at?: string | null
          environment?: string
          company_id: string
          connected_by?: string | null
          last_sync_at?: string | null
          sync_status?: string
          sync_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          client_id?: string
          client_secret_encrypted?: string
          access_token?: string | null
          token_expires_at?: string | null
          environment?: string
          company_id?: string
          connected_by?: string | null
          last_sync_at?: string | null
          sync_status?: string
          sync_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      payroll_accruals: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          accrual_type: string
          description: string
          amount: number
          source: string
          payroll_sync_id: string | null
          account_id: string | null
          offset_account_id: string | null
          status: string
          reversal_period_year: number | null
          reversal_period_month: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          accrual_type: string
          description: string
          amount?: number
          source?: string
          payroll_sync_id?: string | null
          account_id?: string | null
          offset_account_id?: string | null
          status?: string
          reversal_period_year?: number | null
          reversal_period_month?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          accrual_type?: string
          description?: string
          amount?: number
          source?: string
          payroll_sync_id?: string | null
          account_id?: string | null
          offset_account_id?: string | null
          status?: string
          reversal_period_year?: number | null
          reversal_period_month?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      payroll_sync_logs: {
        Row: {
          id: string
          entity_id: string
          started_at: string
          completed_at: string | null
          status: string
          employees_synced: number
          accruals_generated: number
          error_message: string | null
          raw_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          started_at?: string
          completed_at?: string | null
          status?: string
          employees_synced?: number
          accruals_generated?: number
          error_message?: string | null
          raw_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          started_at?: string
          completed_at?: string | null
          status?: string
          employees_synced?: number
          accruals_generated?: number
          error_message?: string | null
          raw_data?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      revenue_schedules: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          source_file_name: string | null
          source_file_path: string | null
          uploaded_by: string | null
          uploaded_at: string | null
          total_accrued_revenue: number
          total_deferred_revenue: number
          total_earned_revenue: number
          total_billed_revenue: number
          accrued_account_id: string | null
          deferred_account_id: string | null
          revenue_account_id: string | null
          status: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          source_file_name?: string | null
          source_file_path?: string | null
          uploaded_by?: string | null
          uploaded_at?: string | null
          total_accrued_revenue?: number
          total_deferred_revenue?: number
          total_earned_revenue?: number
          total_billed_revenue?: number
          accrued_account_id?: string | null
          deferred_account_id?: string | null
          revenue_account_id?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          source_file_name?: string | null
          source_file_path?: string | null
          uploaded_by?: string | null
          uploaded_at?: string | null
          total_accrued_revenue?: number
          total_deferred_revenue?: number
          total_earned_revenue?: number
          total_billed_revenue?: number
          accrued_account_id?: string | null
          deferred_account_id?: string | null
          revenue_account_id?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      revenue_line_items: {
        Row: {
          id: string
          schedule_id: string
          contract_id: string | null
          customer_name: string | null
          description: string | null
          rental_start: string | null
          rental_end: string | null
          total_contract_value: number
          daily_rate: number
          days_in_period: number
          earned_revenue: number
          billed_amount: number
          accrual_amount: number
          deferral_amount: number
          row_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          schedule_id: string
          contract_id?: string | null
          customer_name?: string | null
          description?: string | null
          rental_start?: string | null
          rental_end?: string | null
          total_contract_value?: number
          daily_rate?: number
          days_in_period?: number
          earned_revenue?: number
          billed_amount?: number
          accrual_amount?: number
          deferral_amount?: number
          row_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          schedule_id?: string
          contract_id?: string | null
          customer_name?: string | null
          description?: string | null
          rental_start?: string | null
          rental_end?: string | null
          total_contract_value?: number
          daily_rate?: number
          days_in_period?: number
          earned_revenue?: number
          billed_amount?: number
          accrual_amount?: number
          deferral_amount?: number
          row_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      master_accounts: {
        Row: {
          id: string
          organization_id: string
          account_number: string
          name: string
          description: string | null
          classification: string
          account_type: string
          account_sub_type: string | null
          parent_account_id: string | null
          is_active: boolean
          display_order: number
          normal_balance: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          account_number: string
          name: string
          description?: string | null
          classification: string
          account_type: string
          account_sub_type?: string | null
          parent_account_id?: string | null
          is_active?: boolean
          display_order?: number
          normal_balance?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          account_number?: string
          name?: string
          description?: string | null
          classification?: string
          account_type?: string
          account_sub_type?: string | null
          parent_account_id?: string | null
          is_active?: boolean
          display_order?: number
          normal_balance?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_accounts_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            referencedRelation: "master_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      master_account_mappings: {
        Row: {
          id: string
          master_account_id: string
          entity_id: string
          account_id: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          master_account_id: string
          entity_id: string
          account_id: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          master_account_id?: string
          entity_id?: string
          account_id?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_account_mappings_master_account_id_fkey"
            columns: ["master_account_id"]
            referencedRelation: "master_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_account_mappings_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_account_mappings_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      consolidation_eliminations: {
        Row: {
          id: string
          organization_id: string
          period_year: number
          period_month: number
          description: string
          memo: string | null
          debit_master_account_id: string
          credit_master_account_id: string
          amount: number
          elimination_type: string
          is_recurring: boolean
          status: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          period_year: number
          period_month: number
          description: string
          memo?: string | null
          debit_master_account_id: string
          credit_master_account_id: string
          amount: number
          elimination_type?: string
          is_recurring?: boolean
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          period_year?: number
          period_month?: number
          description?: string
          memo?: string | null
          debit_master_account_id?: string
          credit_master_account_id?: string
          amount?: number
          elimination_type?: string
          is_recurring?: boolean
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consolidation_eliminations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consolidation_eliminations_debit_master_account_id_fkey"
            columns: ["debit_master_account_id"]
            referencedRelation: "master_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consolidation_eliminations_credit_master_account_id_fkey"
            columns: ["credit_master_account_id"]
            referencedRelation: "master_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_entity_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      user_entity_role: {
        Args: {
          p_entity_id: string
        }
        Returns: string
      }
      user_org_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
