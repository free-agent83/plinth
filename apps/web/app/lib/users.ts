// Typed mock user directory for the Users screen.

export interface User {
  id: string;
  name: string;
  initials: string;
  email: string;
  role: "Admin" | "Editor" | "Viewer";
  status: "success" | "warning" | "danger";
  statusLabel: string;
  joined: Date;
}

export const roles = ["Admin", "Editor", "Viewer"] as const;

export const users: User[] = [
  { id: "u1", name: "Ada Lovelace", initials: "AL", email: "ada@example.com", role: "Admin", status: "success", statusLabel: "Active", joined: new Date(2025, 0, 12) },
  { id: "u2", name: "Grace Hopper", initials: "GH", email: "grace@example.com", role: "Editor", status: "success", statusLabel: "Active", joined: new Date(2025, 2, 3) },
  { id: "u3", name: "Alan Turing", initials: "AT", email: "alan@example.com", role: "Admin", status: "warning", statusLabel: "Invited", joined: new Date(2025, 4, 21) },
  { id: "u4", name: "Katherine Johnson", initials: "KJ", email: "katherine@example.com", role: "Viewer", status: "success", statusLabel: "Active", joined: new Date(2025, 5, 8) },
  { id: "u5", name: "Margaret Hamilton", initials: "MH", email: "margaret@example.com", role: "Editor", status: "danger", statusLabel: "Suspended", joined: new Date(2025, 6, 30) },
  { id: "u6", name: "Dorothy Vaughan", initials: "DV", email: "dorothy@example.com", role: "Viewer", status: "success", statusLabel: "Active", joined: new Date(2026, 0, 15) },
  { id: "u7", name: "Barbara Liskov", initials: "BL", email: "barbara@example.com", role: "Admin", status: "success", statusLabel: "Active", joined: new Date(2026, 1, 26) },
  { id: "u8", name: "Radia Perlman", initials: "RP", email: "radia@example.com", role: "Editor", status: "warning", statusLabel: "Invited", joined: new Date(2026, 3, 9) },
];
