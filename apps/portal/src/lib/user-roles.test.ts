import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_USER_ROLE,
  normalizeUserRole,
  ROLE_HIERARCHY,
  roleSatisfies,
} from "./user-roles";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("user roles schema", () => {
  it("adds user_roles with bootstrap and admin helpers", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000014_create_user_roles.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.user_roles");
    expect(source).toContain("user_id uuid primary key references auth.users(id)");
    expect(source).toContain("create or replace function public.is_admin");
    expect(source).toContain("create or replace function public.get_effective_role");
    expect(source).toContain("create or replace function public.bootstrap_user_role");
    expect(source).toContain("assigned_role := case");
    expect(source).toContain("then 'operator'");
    expect(source).toContain("else 'admin'");
  });
});

describe("user role helpers", () => {
  it("defaults unknown or missing roles to operator", () => {
    expect(DEFAULT_USER_ROLE).toBe("operator");
    expect(normalizeUserRole(null)).toBe("operator");
    expect(normalizeUserRole(undefined)).toBe("operator");
    expect(normalizeUserRole("invalid")).toBe("operator");
  });

  it("uses additive inherited role checks", () => {
    expect(ROLE_HIERARCHY).toEqual(["viewer", "sales", "operator", "admin"]);
    expect(roleSatisfies("admin", "operator")).toBe(true);
    expect(roleSatisfies("operator", "sales")).toBe(true);
    expect(roleSatisfies("sales", "admin")).toBe(false);
    expect(roleSatisfies("viewer", "viewer")).toBe(true);
  });
});

describe("role integration", () => {
  it("bootsraps current user role from the dashboard layout and shows it", () => {
    const layoutPath = join(__dirname, "../app/dashboard/layout.tsx");
    const source = readFileSync(layoutPath, "utf-8");
    expect(source).toContain("bootstrapCurrentUserRole");
    expect(source).toContain('data-testid="current-user-role"');
  });

  it("exposes getUserRole and requireRole server helpers", () => {
    const helperPath = join(__dirname, "user-role-server.ts");
    const source = readFileSync(helperPath, "utf-8");
    expect(source).toContain("export async function getUserRole");
    expect(source).toContain("export async function bootstrapCurrentUserRole");
    expect(source).toContain('rpc("bootstrap_user_role"');
    expect(source).toContain("export async function requireRole");
    expect(source).toContain("Requires");
  });
});
