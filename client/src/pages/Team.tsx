import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Shield, Wrench, Eye, Briefcase, Trash2 } from "lucide-react";

const ROLE_CONFIG = {
  manager: { label: "Manager", icon: Shield, color: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800" },
  tech: { label: "Technician", icon: Wrench, color: "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800" },
  sales: { label: "Sales Team", icon: Briefcase, color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800" },
  staff: { label: "Staff", icon: Eye, color: "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800" },
} as const;

interface UserData {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  active: number;
  mustChangePassword: number;
  createdAt: string;
}

export default function Team() {
  const { toast } = useToast();
  const currentUser = getUser();
  const [showDialog, setShowDialog] = useState(false);
  const [editUser, setEditUser] = useState<UserData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserData | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", email: "", password: "", confirmPassword: "", role: "tech" });
  const [passwordError, setPasswordError] = useState("");

  const { data: users = [], isLoading } = useQuery<UserData[]>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/users", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setShowDialog(false);
      resetForm();
      toast({ title: "User created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditUser(null);
      setShowDialog(false);
      resetForm();
      toast({ title: "User updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => { setForm({ username: "", displayName: "", email: "", password: "", confirmPassword: "", role: "tech" }); setPasswordError(""); };

  const openCreate = () => {
    resetForm();
    setEditUser(null);
    setShowDialog(true);
  };

  const openEdit = (user: UserData) => {
    setEditUser(user);
    setForm({ username: user.username, displayName: user.displayName, email: user.email || "", password: "", role: user.role });
    setShowDialog(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    if (editUser) {
      // Editing: if a new password is entered, confirm must match
      if (form.password && form.password !== form.confirmPassword) {
        setPasswordError("Passwords do not match");
        return;
      }
      const data: any = { displayName: form.displayName, email: form.email || null, role: form.role };
      if (form.password) data.password = form.password;
      updateMutation.mutate({ id: editUser.id, data });
    } else {
      // Creating: confirm password required and must match
      if (form.password !== form.confirmPassword) {
        setPasswordError("Passwords do not match");
        return;
      }
      createMutation.mutate(form);
    }
  };

  const toggleActive = (user: UserData) => {
    updateMutation.mutate({ id: user.id, data: { active: user.active ? 0 : 1 } });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/users/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setDeleteTarget(null);
      toast({ title: "User permanently deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const activeUsers = users.filter(u => u.active);
  const inactiveUsers = users.filter(u => !u.active);

  return (
    <main className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground">Manage user accounts and roles</p>
        </div>
        <Button onClick={openCreate} className="bg-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,35%)]">
          <Plus className="w-4 h-4 mr-1" /> Add User
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(ROLE_CONFIG).map(([role, config]) => {
          const count = activeUsers.filter(u => u.role === role).length;
          const Icon = config.icon;
          return (
            <div key={role} className="bg-card rounded-lg border p-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">{config.label}s</p>
                <p className="text-2xl font-bold mt-1">{count}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${config.color} border`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          );
        })}
      </div>

      {/* User List */}
      {isLoading ? (
        <div className="text-center text-muted-foreground text-sm py-12">Loading...</div>
      ) : (
        <div className="bg-card rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">User</th>
                  <th className="text-left p-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Role</th>
                  <th className="text-left p-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Status</th>
                  <th className="text-right p-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...activeUsers, ...inactiveUsers].map(user => {
                  const roleConf = ROLE_CONFIG[user.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.tech;
                  return (
                    <tr key={user.id} className={`border-b last:border-0 hover:bg-muted/20 ${!user.active ? "opacity-50" : ""}`}>
                      <td className="p-3">
                        <div className="font-medium">{user.displayName}</div>
                        <div className="text-xs text-muted-foreground">{user.username}{user.email ? ` · ${user.email}` : ""}</div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-xs ${roleConf.color}`}>{roleConf.label}</Badge>
                      </td>
                      <td className="p-3">
                        {user.active ? (
                          <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-xs">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-xs">Inactive</Badge>
                        )}
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(user)} className={user.active ? "text-amber-500 hover:text-amber-700" : "text-emerald-500 hover:text-emerald-700"}>
                          {user.active ? "Deactivate" : "Activate"}
                        </Button>
                        {currentUser?.id !== user.id && (
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(user)} className="text-red-500 hover:text-red-700">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Permanently Delete User?</DialogTitle>
            <DialogDescription>
              This will permanently remove <strong>{deleteTarget?.displayName}</strong> ({deleteTarget?.username}) from the system. This cannot be undone.
              Their activity log entries will be retained but unlinked from this account.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editUser ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!editUser && (
              <div>
                <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Username</label>
                <Input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required />
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Display Name</label>
              <Input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} required />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Email</label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">{editUser ? "Reset Password (leave blank to keep)" : "Password"}</label>
              <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required={!editUser} placeholder={editUser ? "Leave blank to keep current" : "Min 8 characters"} />
            </div>
            {(!editUser || form.password) && (
              <div>
                <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Confirm Password</label>
                <Input type="password" value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} required={!editUser || !!form.password} placeholder="Re-enter password" />
                {passwordError && <p className="text-xs text-destructive mt-1">{passwordError}</p>}
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Role</label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="tech">Technician</SelectItem>
                  <SelectItem value="sales">Sales Team</SelectItem>
                  <SelectItem value="staff">Staff (View Only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button type="submit" className="bg-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,35%)]" disabled={createMutation.isPending || updateMutation.isPending}>
                {editUser ? "Save Changes" : "Create User"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
