"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

/* ---------- Types ---------- */

interface Carrier {
  id?: string;
  entity_id?: string;
  name: string;
  am_best_rating: string | null;
  naic_number: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
}

interface Broker {
  id?: string;
  entity_id?: string;
  name: string;
  license_number: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
}

const emptyCarrier: Carrier = {
  name: "",
  am_best_rating: null,
  naic_number: null,
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  notes: null,
};

const emptyBroker: Broker = {
  name: "",
  license_number: null,
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  notes: null,
};

/* ---------- Component ---------- */

export default function InsuranceSettingsPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  /* --- Carriers state --- */
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [carrierDialogOpen, setCarrierDialogOpen] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState<Carrier>(emptyCarrier);
  const [savingCarrier, setSavingCarrier] = useState(false);
  const [deletingCarrierId, setDeletingCarrierId] = useState<string | null>(null);

  /* --- Brokers state --- */
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [brokerDialogOpen, setBrokerDialogOpen] = useState(false);
  const [editingBroker, setEditingBroker] = useState<Broker>(emptyBroker);
  const [savingBroker, setSavingBroker] = useState(false);
  const [deletingBrokerId, setDeletingBrokerId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  /* ---------- Load data ---------- */

  const loadCarriers = useCallback(async () => {
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_carriers", entityId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCarriers(data.carriers || []);
    } catch (err) {
      toast.error("Failed to load carriers");
    }
  }, [entityId]);

  const loadBrokers = useCallback(async () => {
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_brokers", entityId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBrokers(data.brokers || []);
    } catch (err) {
      toast.error("Failed to load brokers");
    }
  }, [entityId]);

  useEffect(() => {
    Promise.all([loadCarriers(), loadBrokers()]).finally(() =>
      setLoading(false)
    );
  }, [loadCarriers, loadBrokers]);

  /* ---------- Carrier CRUD ---------- */

  const openCarrierDialog = (carrier?: Carrier) => {
    setEditingCarrier(carrier ? { ...carrier } : { ...emptyCarrier });
    setCarrierDialogOpen(true);
  };

  const saveCarrier = async () => {
    if (!editingCarrier.name.trim()) {
      toast.error("Carrier name is required");
      return;
    }
    setSavingCarrier(true);
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_carrier",
          entityId,
          carrier: editingCarrier,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(editingCarrier.id ? "Carrier updated" : "Carrier added");
      setCarrierDialogOpen(false);
      await loadCarriers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save carrier");
    } finally {
      setSavingCarrier(false);
    }
  };

  const deleteCarrier = async (carrierId: string) => {
    if (!confirm("Are you sure you want to delete this carrier?")) return;
    setDeletingCarrierId(carrierId);
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_carrier", carrierId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success("Carrier deleted");
      await loadCarriers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete carrier");
    } finally {
      setDeletingCarrierId(null);
    }
  };

  /* ---------- Broker CRUD ---------- */

  const openBrokerDialog = (broker?: Broker) => {
    setEditingBroker(broker ? { ...broker } : { ...emptyBroker });
    setBrokerDialogOpen(true);
  };

  const saveBroker = async () => {
    if (!editingBroker.name.trim()) {
      toast.error("Broker name is required");
      return;
    }
    setSavingBroker(true);
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_broker",
          entityId,
          broker: editingBroker,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(editingBroker.id ? "Broker updated" : "Broker added");
      setBrokerDialogOpen(false);
      await loadBrokers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save broker");
    } finally {
      setSavingBroker(false);
    }
  };

  const deleteBroker = async (brokerId: string) => {
    if (!confirm("Are you sure you want to delete this broker?")) return;
    setDeletingBrokerId(brokerId);
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_broker", brokerId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success("Broker deleted");
      await loadBrokers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete broker");
    } finally {
      setDeletingBrokerId(null);
    }
  };

  /* ---------- Loading state ---------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /* ---------- Render ---------- */

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/${entityId}/insurance`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Insurance Settings</h1>
          <p className="text-muted-foreground">
            Manage insurance carriers and brokers
          </p>
        </div>
      </div>

      {/* ===== Carriers Section ===== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Carriers</CardTitle>
          <Button size="sm" onClick={() => openCarrierDialog()}>
            <Plus className="mr-1 h-4 w-4" />
            Add Carrier
          </Button>
        </CardHeader>
        <CardContent>
          {carriers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No carriers configured yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>AM Best Rating</TableHead>
                  <TableHead>NAIC #</TableHead>
                  <TableHead>Contact Name</TableHead>
                  <TableHead>Contact Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carriers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.am_best_rating || "-"}</TableCell>
                    <TableCell>{c.naic_number || "-"}</TableCell>
                    <TableCell>{c.contact_name || "-"}</TableCell>
                    <TableCell>{c.contact_email || "-"}</TableCell>
                    <TableCell>{c.contact_phone || "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openCarrierDialog(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={deletingCarrierId === c.id}
                          onClick={() => c.id && deleteCarrier(c.id)}
                        >
                          {deletingCarrierId === c.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ===== Brokers Section ===== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Brokers</CardTitle>
          <Button size="sm" onClick={() => openBrokerDialog()}>
            <Plus className="mr-1 h-4 w-4" />
            Add Broker
          </Button>
        </CardHeader>
        <CardContent>
          {brokers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No brokers configured yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>License #</TableHead>
                  <TableHead>Contact Name</TableHead>
                  <TableHead>Contact Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {brokers.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>{b.license_number || "-"}</TableCell>
                    <TableCell>{b.contact_name || "-"}</TableCell>
                    <TableCell>{b.contact_email || "-"}</TableCell>
                    <TableCell>{b.contact_phone || "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openBrokerDialog(b)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={deletingBrokerId === b.id}
                          onClick={() => b.id && deleteBroker(b.id)}
                        >
                          {deletingBrokerId === b.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ===== Carrier Dialog ===== */}
      <Dialog open={carrierDialogOpen} onOpenChange={setCarrierDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingCarrier.id ? "Edit Carrier" : "Add Carrier"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-1">
              <Label htmlFor="carrier-name">Name *</Label>
              <Input
                id="carrier-name"
                value={editingCarrier.name}
                onChange={(e) =>
                  setEditingCarrier({ ...editingCarrier, name: e.target.value })
                }
                placeholder="e.g., Hartford Financial"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="carrier-rating">AM Best Rating</Label>
                <Input
                  id="carrier-rating"
                  value={editingCarrier.am_best_rating || ""}
                  onChange={(e) =>
                    setEditingCarrier({
                      ...editingCarrier,
                      am_best_rating: e.target.value || null,
                    })
                  }
                  placeholder="e.g., A+"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="carrier-naic">NAIC #</Label>
                <Input
                  id="carrier-naic"
                  value={editingCarrier.naic_number || ""}
                  onChange={(e) =>
                    setEditingCarrier({
                      ...editingCarrier,
                      naic_number: e.target.value || null,
                    })
                  }
                  placeholder="e.g., 30104"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="carrier-contact-name">Contact Name</Label>
              <Input
                id="carrier-contact-name"
                value={editingCarrier.contact_name || ""}
                onChange={(e) =>
                  setEditingCarrier({
                    ...editingCarrier,
                    contact_name: e.target.value || null,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="carrier-email">Contact Email</Label>
                <Input
                  id="carrier-email"
                  type="email"
                  value={editingCarrier.contact_email || ""}
                  onChange={(e) =>
                    setEditingCarrier({
                      ...editingCarrier,
                      contact_email: e.target.value || null,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="carrier-phone">Phone</Label>
                <Input
                  id="carrier-phone"
                  value={editingCarrier.contact_phone || ""}
                  onChange={(e) =>
                    setEditingCarrier({
                      ...editingCarrier,
                      contact_phone: e.target.value || null,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="carrier-notes">Notes</Label>
              <Textarea
                id="carrier-notes"
                value={editingCarrier.notes || ""}
                onChange={(e) =>
                  setEditingCarrier({
                    ...editingCarrier,
                    notes: e.target.value || null,
                  })
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCarrierDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={saveCarrier} disabled={savingCarrier}>
              {savingCarrier && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingCarrier.id ? "Update" : "Add"} Carrier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Broker Dialog ===== */}
      <Dialog open={brokerDialogOpen} onOpenChange={setBrokerDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingBroker.id ? "Edit Broker" : "Add Broker"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-1">
              <Label htmlFor="broker-name">Name *</Label>
              <Input
                id="broker-name"
                value={editingBroker.name}
                onChange={(e) =>
                  setEditingBroker({ ...editingBroker, name: e.target.value })
                }
                placeholder="e.g., Marsh McLennan"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="broker-license">License #</Label>
              <Input
                id="broker-license"
                value={editingBroker.license_number || ""}
                onChange={(e) =>
                  setEditingBroker({
                    ...editingBroker,
                    license_number: e.target.value || null,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="broker-contact-name">Contact Name</Label>
              <Input
                id="broker-contact-name"
                value={editingBroker.contact_name || ""}
                onChange={(e) =>
                  setEditingBroker({
                    ...editingBroker,
                    contact_name: e.target.value || null,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="broker-email">Contact Email</Label>
                <Input
                  id="broker-email"
                  type="email"
                  value={editingBroker.contact_email || ""}
                  onChange={(e) =>
                    setEditingBroker({
                      ...editingBroker,
                      contact_email: e.target.value || null,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="broker-phone">Phone</Label>
                <Input
                  id="broker-phone"
                  value={editingBroker.contact_phone || ""}
                  onChange={(e) =>
                    setEditingBroker({
                      ...editingBroker,
                      contact_phone: e.target.value || null,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="broker-notes">Notes</Label>
              <Textarea
                id="broker-notes"
                value={editingBroker.notes || ""}
                onChange={(e) =>
                  setEditingBroker({
                    ...editingBroker,
                    notes: e.target.value || null,
                  })
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBrokerDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={saveBroker} disabled={savingBroker}>
              {savingBroker && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingBroker.id ? "Update" : "Add"} Broker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
