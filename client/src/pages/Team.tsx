import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Shield, Wrench, Eye, Briefcase } from "lucide-react";

const ROLE_CONFIG = {
  manager: { label: "Manager", icon: Shield, color: "text-amber-600 bg-amber-50 border-amber-200" },
  tech: { label: "Technician", icon: Wrench, color: "text-sky-600 bg-sky-50 border-sky-200" },
  sales: { label: "Sales Team", icon: Briefcase, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  staff: { label: "Staff", icon: Eye, color: "text-violet-600 bg-violet-50 border-violet-200" },
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
  const [showDialog, setShowDialog] = useState(false);
  const [editUser, setEditUser] = useState<UserData | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", email: "", password: "", role: "tech" });

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

  const resetForm = () => setForm({ username: "", displayName: "", email: "", password: "", role: "tech" });

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
    if (editUser) {
      const data: any = { displayName: form.displayName, email: form.email || null, role: form.role };
      if (form.password) data.password = form.password;
      updateMutation.mutate({ id: editUser.id, data });
    } else {
      createMutation.mutate(form);
    }
  };

  const toggleActive = (user: UserData) => {
    updateMutation.mutate({ id: user.id, data: { active: user.active ? 0 : 1 } });
  };

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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Object.entries(ROLE_CONFIG).map(([role, config]) => {
          const count = activeUsers.filter(u => u.role === role).length;
          const Icon = config.icon;
          return (
            <div key={role} className="bg-white rounded-lg border p-5 flex items-center justify-between">
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
        <div className="bg-white rounded-lg border overflow-hidden">
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
                          <Badge variant="outline" className="text-emerald-600 bg-emerald-50 border-emerald-200 text-xs">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-red-600 bg-red-50 border-red-200 text-xs">Inactive</Badge>
                        )}
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(user)} className={user.active ? "text-red-500 hover:text-red-700" : "text-emerald-500 hover:text-emerald-700"}>
                          {user.active ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
