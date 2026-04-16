"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface RegisterSettingsProps {
  entityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (openingDate: string) => void;
}

export function RegisterSettings({
  entityId,
  open,
  onOpenChange,
  onSaved,
}: RegisterSettingsProps) {
  const [openingDate, setOpeningDate] = useState<string>("");
  const [combineFleetAccumDepr, setCombineFleetAccumDepr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/assets/settings?entityId=${entityId}`);
    if (res.ok) {
      const data = await res.json();
      setOpeningDate(data.rental_asset_opening_date ?? "");
      setCombineFleetAccumDepr(Boolean(data.combine_fleet_accum_depr));
    }
    setLoading(false);
  }, [entityId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleSave = async () => {
    if (!openingDate) {
      toast.error("Opening date is required");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/assets/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityId,
        rental_asset_opening_date: openingDate,
        combine_fleet_accum_depr: combineFleetAccumDepr,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      toast.success("Register settings saved");
      onSaved?.(data.rental_asset_opening_date);
      onOpenChange(false);
    } else {
      const err = await res.json();
      toast.error(err.error || "Failed to save");
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Rental Asset Register Settings</DialogTitle>
          <DialogDescription>
            Configure the opening balance cutoff for the rental asset register.
            Imported accumulated depreciation is anchored to this date, and
            depreciation is calculated forward from the following month.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="openingDate">Opening Balance Date</Label>
            <Input
              id="openingDate"
              type="date"
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
              disabled={loading || saving}
            />
            <p className="text-xs text-muted-foreground">
              Typically a fiscal year-end date (e.g. 2024-12-31). Assets placed
              in service on or before this date with imported accumulated
              depreciation are treated as opening balances; everything else is
              generated from the in-service date forward.
            </p>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label className="text-sm font-medium">
              Reconciliation Settings
            </Label>
            <div className="flex items-start gap-2">
              <Checkbox
                id="combineFleetAccumDepr"
                checked={combineFleetAccumDepr}
                onCheckedChange={(v) =>
                  setCombineFleetAccumDepr(v === true)
                }
                disabled={loading || saving}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label
                  htmlFor="combineFleetAccumDepr"
                  className="text-sm font-normal cursor-pointer"
                >
                  Combine Vehicles + Trailers for Accumulated Depreciation
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable when this entity&apos;s QuickBooks uses a single
                  Accumulated Depreciation account for both vehicles and
                  trailers. The reconciliation tab will show one combined
                  Fleet — Accumulated Depreciation group instead of separate
                  ones, and you&apos;ll link the shared GL account there.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
